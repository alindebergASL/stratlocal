import { afterEach, expect, test, vi } from 'vitest';
import { providerProblem, getClient } from '../lib/ai/client';
import { providerChecks, backupCheck } from '../lib/setup';
afterEach(()=>vi.unstubAllEnvs());
test('local mode rejects cloud providers even with credentials and fake AI enabled',()=>{
 vi.stubEnv('STRATEGY_LOCAL_ONLY','1');
 vi.stubEnv('ANTHROPIC_API_KEY','test-not-a-key');
 vi.stubEnv('AWS_REGION','us-east-1');
 vi.stubEnv('AI_FAKE','1');
 for(const provider of ['direct','bedrock'] as const) {
   expect(providerProblem(provider)).toMatch(/External AI is disabled/);
   expect(()=>getClient(provider)).toThrow(/External AI is disabled/);
 }
});
test('cloud AI is off by default and setup does not require cloud providers or contact S3',async()=>{
 vi.stubEnv('STRATEGY_LOCAL_ONLY',undefined);
 vi.stubEnv('ANTHROPIC_API_KEY','test-not-a-key');
 vi.stubEnv('AWS_REGION','us-east-1');
 vi.stubEnv('BACKUP_S3_URI','s3://synthetic-unused-bucket');
 expect(()=>getClient('bedrock')).toThrow(/External AI is disabled/);
 expect(()=>getClient('direct')).toThrow(/External AI is disabled/);
 expect(providerChecks()).toEqual([expect.objectContaining({state:'ok',value:'Local only — cloud AI off'})]);
 expect(await backupCheck()).toMatchObject({label:'Local backup',value:'Manual backup and restore'});
});
