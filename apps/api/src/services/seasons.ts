export function shouldResetSeasonBalances(wasActive: boolean, willBeActive: boolean) {
  return willBeActive && !wasActive;
}
