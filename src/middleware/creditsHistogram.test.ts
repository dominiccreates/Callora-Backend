import { Request, Response, NextFunction } from 'express';
import { creditsHistogramMiddleware } from './creditsHistogram.js';
import * as registry from '../metrics/registry.js';
import { performance } from 'node:perf_hooks';

// Mock performance.now to return deterministic values
jest.mock('node:perf_hooks', () => {
  let time = 0;
  return {
    performance: {
      now: jest.fn(() => {
        const current = time;
        time += 50;
        return current;
      })
    }
  };
});

describe('Credits Histogram Middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let resFinishCallback: () => void;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // There is no resetCreditsMetrics in registry.ts currently, but we can mock observe directly
    // Let's spy on recordCreditsDuration or just spy on observe of creditsDuration.
    
    req = {};
    res = {
      statusCode: 200,
      on: jest.fn((event, cb) => {
        if (event === 'finish') {
          resFinishCallback = cb;
        }
        return res as any;
      }),
    };
    next = jest.fn();
  });

  it('should record duration exactly once with status class', () => {
    creditsHistogramMiddleware(req as Request, res as Response, next);
    
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
    
    const observeSpy = jest.spyOn(registry.creditsDuration, 'observe');
    
    resFinishCallback();
    
    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(observeSpy).toHaveBeenCalledWith(
      { route: '/api/billing/credits', status_code: '200' },
      expect.any(Number)
    );

    const durationArg = observeSpy.mock.calls[0][1] as number;
    expect(durationArg).toBeGreaterThanOrEqual(0);
  });

  it('should handle aborted requests if skipped/closed without finish appropriately', () => {
    creditsHistogramMiddleware(req as Request, res as Response, next);
    const observeSpy = jest.spyOn(registry.creditsDuration, 'observe');
    // Not calling resFinishCallback simulates abort/close without finish
    expect(observeSpy).toHaveBeenCalledTimes(0);
  });
});
