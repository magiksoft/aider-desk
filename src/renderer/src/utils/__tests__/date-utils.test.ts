import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskData } from '@common/types';

import { formatDateShort, getTaskDateGroup, groupTasksByDate, isToday, isYesterday } from '../date-utils';

describe('date-utils', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('identifies today and yesterday including year checks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 16, 12, 0, 0));

    expect(isToday(new Date(2026, 3, 16, 8, 0, 0).toISOString())).toBe(true);
    expect(isToday(new Date(2025, 3, 16, 8, 0, 0).toISOString())).toBe(false);

    expect(isYesterday(new Date(2026, 3, 15, 8, 0, 0).toISOString())).toBe(true);
    expect(isYesterday(new Date(2025, 3, 15, 8, 0, 0).toISOString())).toBe(false);
  });

  it('omits year for dates in the current year and includes year for other years', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 16, 12, 0, 0));

    const currentYearDate = new Date(2026, 0, 15, 10, 0, 0).toISOString();
    const previousYearDate = new Date(2025, 0, 15, 10, 0, 0).toISOString();

    const expectedMonth = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(2026, 0, 15));

    expect(formatDateShort(currentYearDate)).toBe(`${expectedMonth} 15`);
    expect(formatDateShort(previousYearDate)).toBe(`${expectedMonth} 15, 2025`);
  });

  it('groups tasks on the same month and day from different years separately', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 20, 12, 0, 0));

    const tasks = [
      { id: '1', name: 'This Year Task', updatedAt: new Date(2026, 0, 15, 10, 0, 0).toISOString() },
      { id: '2', name: 'Last Year Task', updatedAt: new Date(2025, 0, 15, 10, 0, 0).toISOString() },
    ] as TaskData[];

    expect(getTaskDateGroup(tasks[0])).not.toBe(getTaskDateGroup(tasks[1]));

    const grouped = groupTasksByDate(tasks);
    expect(grouped.size).toBe(2);
    expect(Array.from(grouped.values()).map((g) => g.map((t) => t.id))).toEqual([['1'], ['2']]);
  });
});
