// StrategyLocal starts with cloud AI disabled. Inherited cloud AI requires an
// explicit opt-in; credentials alone never enable them.
export function localOnly(): boolean {
  return process.env.STRATEGY_LOCAL_ONLY !== "0";
}
