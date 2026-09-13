import { KeyedDebouncer } from './keyed-debouncer';

describe('KeyedDebouncer', () => {
  it('coalesces writes scheduled in the same turn and keeps the latest value', async () => {
    const flushed: Array<{ key: string; value: number }> = [];
    const debouncer = new KeyedDebouncer<number>(async (key, value) => {
      flushed.push({ key, value });
    });

    const first = debouncer.schedule('user-1', 1);
    const second = debouncer.schedule('user-1', 2);
    const third = debouncer.schedule('user-1', 3);

    await Promise.all([first, second, third]);

    expect(flushed).toEqual([{ key: 'user-1', value: 3 }]);
    expect(debouncer.pendingKeys).toBe(0);
  });

  it('schedules independent flushes for different keys', async () => {
    const flushed: string[] = [];
    const debouncer = new KeyedDebouncer<string>(async (key) => {
      flushed.push(key);
    });

    await Promise.all([debouncer.schedule('a', 'a'), debouncer.schedule('b', 'b')]);

    expect(flushed.sort()).toEqual(['a', 'b']);
  });

  it('propagates a flush failure to every coalesced caller', async () => {
    const debouncer = new KeyedDebouncer<number>(async () => {
      throw new Error('write failed');
    });

    const first = debouncer.schedule('user-1', 1);
    const second = debouncer.schedule('user-1', 2);

    await expect(first).rejects.toThrow('write failed');
    await expect(second).rejects.toThrow('write failed');
  });

  it('flushes a pending key on demand', async () => {
    const flushed: number[] = [];
    const debouncer = new KeyedDebouncer<number>(async (_key, value) => {
      flushed.push(value);
    });

    const pending = debouncer.schedule('user-1', 42);
    await debouncer.flushKey('user-1');
    await pending;

    expect(flushed).toEqual([42]);
    expect(debouncer.pendingKeys).toBe(0);
  });

  it('is a no-op when flushing a key with nothing pending', async () => {
    const debouncer = new KeyedDebouncer<number>(async () => undefined);

    await expect(debouncer.flushKey('missing')).resolves.toBeUndefined();
  });

  it('flushes every pending key on shutdown', async () => {
    const flushed: string[] = [];
    const debouncer = new KeyedDebouncer<string>(async (_key, value) => {
      flushed.push(value);
    });

    void debouncer.schedule('a', 'a');
    void debouncer.schedule('b', 'b');
    await debouncer.flushAll();

    expect(flushed.sort()).toEqual(['a', 'b']);
    expect(debouncer.pendingKeys).toBe(0);
  });
});
