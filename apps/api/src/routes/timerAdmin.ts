import { Router } from 'express';
import { TournamentTimerLevelKind } from '@prisma/client';
import { z } from 'zod';
import {
  applyTournamentTimerAction,
  getOrCreateTournamentTimer,
  replaceTournamentTimerLevels,
  serializeTimer,
  updateTournamentTimerDisplay
} from '../services/tournamentTimer.js';

export const timerAdminRouter = Router();

const levelSchema = z.object({
  kind: z.nativeEnum(TournamentTimerLevelKind),
  durationSeconds: z.coerce.number().int().min(60).max(6 * 60 * 60),
  smallBlind: z.coerce.number().int().min(0).max(100_000_000).nullable().optional(),
  bigBlind: z.coerce.number().int().min(0).max(100_000_000).nullable().optional(),
  ante: z.coerce.number().int().min(0).max(100_000_000).nullable().optional(),
  label: z.string().trim().max(40).nullable().optional()
}).superRefine((level, context) => {
  if (level.kind !== TournamentTimerLevelKind.LEVEL) return;
  if (!level.bigBlind) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['bigBlind'], message: 'Укажите большой блайнд' });
  }
  if ((level.smallBlind ?? 0) > (level.bigBlind ?? 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['smallBlind'], message: 'Малый блайнд не может быть больше большого' });
  }
});

const structureSchema = z.object({
  levels: z.array(levelSchema).min(1, 'Добавьте хотя бы один уровень').max(100, 'Допустимо не больше 100 уровней')
});


const displaySchema = z.object({
  topTicker: z.string().trim().max(260).nullable().optional(),
  bottomTicker: z.string().trim().max(260).nullable().optional(),
  tickerSpeed: z.coerce.number().int().min(8).max(90).default(28)
});

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['START', 'PAUSE', 'RESUME', 'NEXT', 'PREVIOUS', 'RESET', 'FINISH']) }),
  z.object({ action: z.literal('GOTO'), levelIndex: z.coerce.number().int().min(0).max(99) }),
  z.object({ action: z.literal('ADD_TIME'), seconds: z.coerce.number().int().min(-60 * 60).max(60 * 60).refine((value) => value !== 0) }),
  z.object({ action: z.literal('SET_REMAINING'), seconds: z.coerce.number().int().min(1).max(6 * 60 * 60) })
]);

timerAdminRouter.get('/:id/timer', async (req, res, next) => {
  try {
    const timer = await getOrCreateTournamentTimer(req.params.id, req.auth!.userId);
    return res.json(serializeTimer(timer));
  } catch (error) { return next(error); }
});

timerAdminRouter.put('/:id/timer/structure', async (req, res, next) => {
  try {
    const { levels } = structureSchema.parse(req.body);
    const timer = await replaceTournamentTimerLevels(req.params.id, levels, req.auth!.userId);
    return res.json(serializeTimer(timer));
  } catch (error) { return next(error); }
});


timerAdminRouter.put('/:id/timer/display', async (req, res, next) => {
  try {
    const settings = displaySchema.parse(req.body);
    const timer = await updateTournamentTimerDisplay(req.params.id, {
      topTicker: settings.topTicker ?? null,
      bottomTicker: settings.bottomTicker ?? null,
      tickerSpeed: settings.tickerSpeed
    }, req.auth!.userId);
    return res.json(serializeTimer(timer));
  } catch (error) { return next(error); }
});

timerAdminRouter.post('/:id/timer/action', async (req, res, next) => {
  try {
    const action = actionSchema.parse(req.body);
    const timer = await applyTournamentTimerAction(req.params.id, action, req.auth!.userId);
    return res.json(serializeTimer(timer));
  } catch (error) { return next(error); }
});
