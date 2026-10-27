import { afterEach, expect, test, vi } from 'vitest';
import { providerProblem, getClient } from '../lib/ai/client';
afterEach(()=>vi.unstubAllEnvs());
test('local mode rejects cloud providers even with credentials and fake AI enabled',()=>{
 vi.stubEnv('STRATEGY_LOCAL_ONLY','1');
 vi.stubEnv('ANTHROPIC_API_KEY','test-not-a-key');
 vi.stubEnv('AWS_REGION','us-east-1');
 for(const provider of ['direct','bedrock'] as const) {
   expect(providerProblem(provider)).toMatch(/External AI is disabled/);
   expect(()=>getClient(provider)).toThrow(/External AI is disabled/);
 }
});
