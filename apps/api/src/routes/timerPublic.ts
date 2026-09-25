import { Router } from 'express';
import { findTournamentTimer, serializeTimer } from '../services/tournamentTimer.js';

export const timerPublicRouter = Router();

timerPublicRouter.get('/:id/timer', async (req, res, next) => {
  try {
    const timer = await findTournamentTimer(req.params.id);
    if (!timer) return res.status(404).json({ message: 'Таймер для этого турнира ещё не настроен' });
    return res.json(serializeTimer(timer));
  } catch (error) { return next(error); }
});
