import {describe,it,expect} from 'vitest';
import {parseOutreachCommand,normalizeCareTopic,careMessage,CARE_WINDOW_MS,audioNeedsTypedConfirmation,outreachDue} from '@yaoyao/application';
describe('explicit one-shot care topics',()=>{
 it('normalizes bounded topics without inventing the outcome',()=>{
  expect(normalizeCareTopic('  项目　进展 ')).toBe('项目 进展');expect(CARE_WINDOW_MS).toBe(1800000);
  for(const input of ['', '字'.repeat(41),'面试\n结束','面试\u0000'])expect(normalizeCareTopic(input)).toBeNull();
  expect(careMessage('面试')).toBe('想听你说说「面试」这件事。');expect(careMessage('旅行')).not.toMatch(/结束|回来|顺利|已经/);expect(()=>careMessage(' 项目 ')).toThrow();
 });
 it('requires an exact typed command, keeps care controls out of the speech/model path',()=>{
  expect(parseOutreachCommand('添加关心：明天 18:00 | 面试')).toEqual({type:'care-add',when:'明天 18:00',topic:'面试'});
  for(const t of ['关心列表','关心帮助','取消关心 ABCD1234','结束关心 abcd1234']){expect(parseOutreachCommand(t)).not.toBeNull();expect(audioNeedsTypedConfirmation(t)).toBe(true);}
  expect(audioNeedsTypedConfirmation('添加关心：明天 18:00 | 面试')).toBe(true);
  for(const t of ['请关心一下我','他说“添加关心：明天 18:00 | 面试”','不要添加关心：明天 18:00 | 面试','面试结束了'])expect(parseOutreachCommand(t)).toBeNull();
 });
 it('rejects malformed times, missing or overlong topics and incomplete cancellation',()=>{
  for(const t of ['添加关心：明天 24:00 | 面试','添加关心：明天 18:00 | ','添加关心：明天 18:00 | '+'字'.repeat(41),'取消关心 nope'])expect(parseOutreachCommand(t)).toEqual({type:'invalid'});
  expect(outreachDue('2026-11-01 01:30','America/New_York',new Date('2026-10-28T00:00Z'))).toBeNull();
 });
});
