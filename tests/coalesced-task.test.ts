import { expect, test } from 'bun:test';
import { coalescedTask } from '../src/adapters/coalesced-task';

test('a burst persists the latest state once and flush cancels the trailing write', async () => {
  let state = 0; const saved: number[] = [];
  const task = coalescedTask(() => saved.push(state), 20);
  for (; state < 500; state++) task.schedule();
  expect(saved).toEqual([]);
  task.flush();
  expect(saved).toEqual([500]);
  await Bun.sleep(60);
  expect(saved).toEqual([500]);
});

test('trailing saves run after a burst, cancellation releases the owner and scheduling can resume', async () => {
  let writes = 0;
  const task = coalescedTask(() => writes++, 20);
  task.schedule(); task.schedule();
  await Bun.sleep(60);
  expect(writes).toBe(1);
  task.schedule(); task.cancel();
  await Bun.sleep(60);
  expect(writes).toBe(1);
  task.schedule(); task.flush();
  expect(writes).toBe(2);
});
