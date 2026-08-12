import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  generatePlanIdeasServer,
  generateTitleCandidatesServer,
  suggestCapacityServer,
  generateScheduleServer,
  reviseScheduleServer,
  generateAnnouncementServer,
  reviseAnnouncementServer,
  generateIconPromptServer,
  generateThumbnailAssetsServer,
  reviseThumbnailPromptServer,
  generateShareTextsServer,
  callGemini,
} from './server/geminiBackend';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '10mb' }));

  // Helper error wrapper for API handlers
  const asyncHandler = (fn: (req: express.Request, res: express.Response) => Promise<any>) => {
    return async (req: express.Request, res: express.Response) => {
      try {
        await fn(req, res);
      } catch (err: any) {
        console.error('API Error:', err);
        res.status(500).json({ error: err.message || 'Internal Server Error' });
      }
    };
  };

  // API Endpoints
  app.post(
    '/api/gemini/generate-plan-ideas',
    asyncHandler(async (req, res) => {
      const { apiKey, profile, feedbackHistory } = req.body;
      const result = await generatePlanIdeasServer(apiKey, profile, feedbackHistory);
      res.json(result);
    })
  );

  app.post(
    '/api/gemini/generate-title-candidates',
    asyncHandler(async (req, res) => {
      const { apiKey, concept, idea } = req.body;
      const result = await generateTitleCandidatesServer(apiKey, concept, idea);
      res.json(result);
    })
  );

  app.post(
    '/api/gemini/suggest-capacity',
    asyncHandler(async (req, res) => {
      const { apiKey, idea, venueTypeOrBasics, venueDetail, durationMinutes } = req.body;
      const result = await suggestCapacityServer(apiKey, idea, venueTypeOrBasics, venueDetail, durationMinutes);
      res.json(result);
    })
  );

  app.post(
    '/api/gemini/generate-schedule',
    asyncHandler(async (req, res) => {
      const { apiKey, basics, concept, idea } = req.body;
      const result = await generateScheduleServer(apiKey, basics, concept, idea);
      res.json(result);
    })
  );

  app.post(
    '/api/gemini/revise-schedule',
    asyncHandler(async (req, res) => {
      const { apiKey, basics, concept, idea, currentSchedule, feedbackHistory } = req.body;
      const result = await reviseScheduleServer(apiKey, basics, concept, idea, currentSchedule, feedbackHistory);
      res.json(result);
    })
  );

  app.post(
    '/api/gemini/generate-announcement',
    asyncHandler(async (req, res) => {
      const { apiKey, profile, concept, basics, formattedDate } = req.body;
      const result = await generateAnnouncementServer(apiKey, profile, concept, basics, formattedDate);
      res.json(result);
    })
  );

  app.post(
    '/api/gemini/revise-announcement',
    asyncHandler(async (req, res) => {
      const { apiKey, profile, currentAnnouncement, feedbackHistory, basics, styleDirective } = req.body;
      const result = await reviseAnnouncementServer(
        apiKey,
        profile,
        currentAnnouncement,
        feedbackHistory,
        basics,
        styleDirective
      );
      res.json(result);
    })
  );

  app.post(
    '/api/gemini/generate-icon-prompt',
    asyncHandler(async (req, res) => {
      const { apiKey, concept, idea, basics } = req.body;
      const result = await generateIconPromptServer(apiKey, concept, idea, basics);
      res.json(result);
    })
  );

  app.post(
    '/api/gemini/generate-thumbnail-assets',
    asyncHandler(async (req, res) => {
      const { apiKey, concept, idea, basics, formattedDate } = req.body;
      const result = await generateThumbnailAssetsServer(apiKey, concept, idea, basics, formattedDate);
      res.json(result);
    })
  );

  app.post(
    '/api/gemini/revise-thumbnail-prompt',
    asyncHandler(async (req, res) => {
      const { apiKey, currentPrompt, feedbackHistory, formattedDate } = req.body;
      const result = await reviseThumbnailPromptServer(apiKey, currentPrompt, feedbackHistory, formattedDate);
      res.json(result);
    })
  );

  app.post(
    '/api/gemini/generate-share-texts',
    asyncHandler(async (req, res) => {
      const { apiKey, announcement, basics, region, formattedDate, organizerName, feedbackHistory, styleDirective } =
        req.body;
      const result = await generateShareTextsServer(
        apiKey,
        announcement,
        basics,
        region,
        formattedDate,
        organizerName,
        feedbackHistory,
        styleDirective
      );
      res.json(result);
    })
  );

  app.post(
    '/api/gemini/call',
    asyncHandler(async (req, res) => {
      const { apiKey, prompt } = req.body;
      const result = await callGemini(apiKey, prompt);
      res.json({ text: result });
    })
  );

  // Vite middleware in development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
