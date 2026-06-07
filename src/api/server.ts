import express from 'express';
import cors from 'cors';
import { Router } from 'express';
import path from 'path';

export function startServer(router: Router, port: number = 3000): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Log all HTTP hits
  app.use((req, res, next) => {
    console.log(`[API HTTP] ${req.method} ${req.url}`);
    next();
  });

  // Serve beautiful dashboard at GET /
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
  });

  // Mount API endpoints
  app.use('/', router);

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'Credovu Settlement Engine' });
  });

  app.listen(port, () => {
    console.log(`========================================================`);
    console.log(`  CREDOVU Blockspace Settlement Layer booting...        `);
    console.log(`  Listening on HTTP: http://localhost:${port}            `);
    console.log(`========================================================`);
  });

  return app;
}
