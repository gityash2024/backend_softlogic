jest.mock('@/config', () => ({
  env: {
    PROFANITY_ENABLED: true,
  },
}));

import { filterController } from '@/modules/filter/filter.controller';

describe('FilterController', () => {
  it('flags and cleans profane text with the default dictionary', async () => {
    const req = {
      body: {
        text: 'This is fuck',
      },
    } as any;
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = { status } as any;
    const next = jest.fn();

    await filterController.check(req, res, next);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clean: false,
          filtered: expect.stringContaining('*'),
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('applies custom profanity words passed in the request', async () => {
    const req = {
      body: {
        text: 'Internal codename Foobar must be hidden',
        customWords: ['Foobar'],
      },
    } as any;
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = { status } as any;

    await filterController.check(req, res, jest.fn());

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          clean: false,
          filtered: expect.stringContaining('******'),
        },
      }),
    );
  });
});
