import { Transaction, SystemProgram, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import https from 'https';

export const JITO_TIP_ACCOUNTS = [
  '96gWZ22sgj9wJUujadENgzattg3dm1zwP9S2n5Xy2T4e',
  'HFqU5x63VT4K51mxeRSR2a6VBMmSL4DxJsiQEui12tFn',
  'Cw8CFyM99Hi47qcrgHA7dudmK49oAMdghqF76X9bd1yA',
  'Hi5Z6cRsrknjEQCGn1KHz72o29tZ2Yp6B4gDss3W13d',
  'ADuUkR4m1XXmJ2Pn6FgbZ2bXXdBJyNavH4f5fDE4fbN9',
  'Df15Z6cRsrknjEQCGn1KHz72o29tZ2Yp6B4gDss3W13d',
  'DttWaRJcPjg3YNuA21zxkt54F15X93mJ66h46985w29a',
  '3AVa972MptmgHnUb485125u1gP92617w543169824u1d'
];

export function callJitoRpc(method: string, params: any[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    const blockEngineUrl = process.env.JITO_BLOCK_ENGINE_URL || 'https://ny.r2d2.devnet.jito.wtf';
    let urlString = blockEngineUrl;
    if (!urlString.endsWith('/api/v1/bundles')) {
      urlString = urlString.replace(/\/$/, '') + '/api/v1/bundles';
    }

    const url = new URL(urlString);
    const postData = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: method,
      params: params
    });

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP status ${res.statusCode}: ${data}`));
          }
          const responseJson = JSON.parse(data);
          if (responseJson.error) {
            return reject(new Error(JSON.stringify(responseJson.error)));
          }
          resolve(responseJson.result);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(postData);
    req.end();
  });
}

export interface JitoBundle {
  transactions: Transaction[];
  signatures: string[];
  tipAccount: string;
  tipAmount: number;
}

export class BundleManager {
  private tipPayer: Keypair;
  private tipAccounts: string[] = JITO_TIP_ACCOUNTS;

  constructor(tipPayerPrivateKeyBase58?: string) {
    if (tipPayerPrivateKeyBase58) {
      try {
        const decoded = bs58.decode(tipPayerPrivateKeyBase58.trim());
        this.tipPayer = Keypair.fromSecretKey(decoded);
        console.log(`[BundleManager] Successfully initialized tip-paying wallet: ${this.tipPayer.publicKey.toBase58()}`);
      } catch (err) {
        console.error('[BundleManager] Failed to parse private key as base58, generating mock Keypair:', err);
        this.tipPayer = Keypair.generate();
      }
    } else {
      this.tipPayer = Keypair.generate();
      console.log(`[BundleManager] No tipping key provided. Initialized mock keypair: ${this.tipPayer.publicKey.toBase58()}`);
    }

    // Dynamically retrieve Jito tip accounts from block engine
    this.fetchTipAccounts();
  }

  private async fetchTipAccounts(): Promise<void> {
    try {
      console.log(`[BundleManager] Querying live Jito tip accounts from Block Engine...`);
      const accounts = await callJitoRpc('getTipAccounts');
      if (Array.isArray(accounts) && accounts.length > 0) {
        this.tipAccounts = accounts;
        console.log(`[BundleManager] Successfully fetched ${accounts.length} active Jito tip accounts. First: ${accounts[0]}`);
      }
    } catch (err) {
      console.error(`[BundleManager] Failed to load Jito tip accounts dynamically, falling back to static list. Error:`, err);
    }
  }

  /**
   * Selects a random Jito tip account to mitigate hotspots
   */
  public getRandomTipAccount(): string {
    const index = Math.floor(Math.random() * this.tipAccounts.length);
    return this.tipAccounts[index];
  }

  /**
   * Packages user transactions and appends a Jito tip transaction
   * @param userTxs Array of signed user transactions
   * @param tipLamports The tip amount calculated by the AI engine
   * @param recentBlockhash The blockhash to use for the tip transaction
   * @returns JitoBundle containing all transactions and their meta
   */
  public createBundle(
    userTxs: Transaction[],
    tipLamports: number,
    recentBlockhash: string
  ): JitoBundle {
    const tipAccountStr = this.getRandomTipAccount();
    const tipAccountPubkey = new PublicKey(tipAccountStr);
    
    // Create the Jito tip transaction
    const tipTx = new Transaction({
      feePayer: this.tipPayer.publicKey,
      recentBlockhash: recentBlockhash,
    });

    // Tip is a direct transfer to one of the Jito tip accounts
    tipTx.add(
      SystemProgram.transfer({
        fromPubkey: this.tipPayer.publicKey,
        toPubkey: tipAccountPubkey,
        lamports: BigInt(tipLamports),
      })
    );

    // Sign the tip transaction
    tipTx.sign(this.tipPayer);

    // Bundle is user transactions + the tip transaction at the end
    const bundleTxs = [...userTxs, tipTx];
    
    // Extract signatures
    const signatures: string[] = bundleTxs.map((tx) => {
      if (tx.signature) {
        return tx.signature.toString('hex');
      }
      return Buffer.from(tx.signatures[0]?.signature || new Uint8Array(64)).toString('hex');
    });

    return {
      transactions: bundleTxs,
      signatures: signatures,
      tipAccount: tipAccountStr,
      tipAmount: tipLamports,
    };
  }
}
