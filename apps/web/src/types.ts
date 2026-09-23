export type Role = 'PLAYER' | 'ADMIN';
export type TournamentStatus = 'UPCOMING' | 'ACTIVE' | 'FINISHED' | 'CANCELLED';
export type TournamentRegistrationStatus = 'REGISTERED' | 'WAITLISTED' | 'CHECKED_IN' | 'PLAYED' | 'CANCELLED';
export type TournamentPlayerActionType = 'REBUY' | 'REENTRY' | 'ELIMINATION' | 'BOUNTY' | 'BONUS_XP';

export type PlayerTag = { id: string; name: string; color: string };

export type User = {
  id: string;
  telegramId: string | null;
  email: string | null;
  username: string | null;
  nickname: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  role: Role;
  points: number;
  clubXp: number;
};

export type Player = Pick<User, 'id' | 'firstName' | 'lastName' | 'username' | 'nickname' | 'photoUrl' | 'points'> & { rank?: number };

export type Season = {
  id: string;
  name: string;
  number: number;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  finalizedAt?: string | null;
  finalizedById?: string | null;
  standings?: { rank: number; points: number; user: Pick<User, 'id' | 'firstName' | 'lastName' | 'username'> }[];
  _count?: { tournaments: number; standings?: number };
};

export type Tournament = {
  id: string;
  seasonId: string;
  title: string;
  description: string | null;
  startsAt: string;
  location: string | null;
  capacity: number;
  participantCount: number;
  status: TournamentStatus;
  registrationClosed: boolean;
  registrationDeadline: string | null;
  registration?: { id: string; status: TournamentRegistrationStatus; waitlistPosition: number | null } | null;
  timerAvailable?: boolean;
  season?: { name: string };
  _count?: { results: number; notifications?: number; registrations?: number };
};

export type TournamentTimerStatus = 'READY' | 'RUNNING' | 'PAUSED' | 'FINISHED';
export type TournamentTimerLevelKind = 'LEVEL' | 'BREAK';

export type TournamentTimerLevel = {
  id: string;
  position: number;
  kind: TournamentTimerLevelKind;
  durationSeconds: number;
  smallBlind: number | null;
  bigBlind: number | null;
  ante: number | null;
  label: string | null;
};

export type TournamentTimer = {
  id: string;
  tournamentId: string;
  tournament: Pick<Tournament, 'id' | 'title' | 'status'>;
  status: TournamentTimerStatus;
  currentLevelIndex: number;
  remainingSeconds: number;
  serverNow: string;
  updatedAt: string;
  levels: TournamentTimerLevel[];
};

export type PointTransaction = {
  id: string;
  userId: string;
  seasonId: string;
  createdById: string;
  type: 'AWARD' | 'DEDUCTION' | 'CORRECTION';
  amount: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
  user?: Pick<User, 'id' | 'firstName' | 'lastName' | 'username' | 'points'>;
  createdBy: Pick<User, 'id' | 'firstName' | 'lastName'>;
  season: Pick<Season, 'id' | 'name' | 'isActive' | 'finalizedAt'>;
  reversalOfId?: string | null;
  reversedBy?: { id: string; createdAt: string } | null;
  reversalOf?: { id: string; amount: number; reason: string } | null;
  batch?: { id: string; tournament: { id: string; title: string } | null } | null;
};

export type HomeData = {
  season: Season | null;
  week: number;
  user: Player & Pick<User, 'clubXp'> & { rank: number; totalUsers: number };
  nextTournament: Tournament | null;
  weeklyPoints: number;
  finalTables: number;
  gamesPlayed: number;
  wins: number;
  leaders: Player[];
  branding?: { hasRatingBanner: boolean; accentColor?: string; updatedAt: string | null };
  nextSeating: { seatNumber: number; table: { number: number }; tournament: { id: string; title: string; startsAt: string } } | null;
};

export type ClubXpTransaction = {
  id: string;
  userId: string;
  source: 'DAILY_HAND' | 'REFERRAL_INVITER' | 'REFERRAL_INVITEE' | 'ACHIEVEMENT' | 'ADMIN_ADJUSTMENT' | 'REVERSAL';
  amount: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
};

export type DailyContent = {
  dayKey: string;
  nextDayAt: string;
  timeZone: string;
  clubXp: number;
  tip: { id: string; title: string; body: string; category: string } | null;
  hand: {
    id: string;
    title: string;
    scenario: string;
    heroCards: string[];
    boardCards: string[];
    difficulty: string;
    rewardXp: number;
    options: { id: string; label: string; explanation?: string }[];
    attempt: {
      selectedOptionId: string;
      correctOptionId: string | null;
      isCorrect: boolean;
      awardedXp: number;
      attemptedAt: string;
    } | null;
  } | null;
};

export type ReferralInfo = {
  referralCode: string;
  shareLink: string | null;
  fallbackMiniAppUrl: string;
  rewardXp: number;
  inviteeRewardXp: number;
  enabled: boolean;
  referrals: {
    id: string;
    status: 'PENDING' | 'REWARDED' | 'REJECTED';
    inviterXp: number;
    inviteeXp: number;
    createdAt: string;
    rewardedAt: string | null;
    invitedUser: Pick<User, 'id' | 'firstName' | 'lastName' | 'username' | 'nickname' | 'photoUrl'>;
  }[];
};
