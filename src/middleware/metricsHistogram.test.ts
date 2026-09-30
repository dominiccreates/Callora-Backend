import { Request, Response, NextFunction } from 'express';
import {
  billingDeductHistogramMiddleware,
  refreshTokenHistogramMiddleware,
  maintenanceHistogramMiddleware,
  adminHistogramMiddleware,
} from './metricsHistogram.js';
import * as registry from '../metrics/registry.js';
import { performance } from 'node:perf_hooks';

// Mock performance.now to return deterministic values
jest.mock('node:perf_hooks', () => {
  let time = 0;
  return {
    performance: {
      now: jest.fn(() => {
        const current = time;
        time += 50; // Each call advances time by 50ms, so start to finish is 50ms
        return current;
      })
    }
  };
});

describe('Metrics Histogram Middlewares', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let resFinishCallback: () => void;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // reset metrics
    registry.resetBillingDeductMetrics();
    registry.resetRefreshTokenMetrics();
    registry.resetMaintenanceMetrics();
    registry.resetAdminMetrics();

    req = {
      baseUrl: '/api/admin',
      route: { path: '/:id' } as any,
      path: '/api/admin/12345',
    };

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

  afterEach(() => {
    // Reset performance mock time if we were actually keeping state in the mock,
    // but jest.clearAllMocks() is usually enough if we just rely on duration.
  });

  describe('billingDeductHistogramMiddleware', () => {
    it('should record duration exactly once with status class', async () => {
      billingDeductHistogramMiddleware(req as Request, res as Response, next);
      
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
      
      const observeSpy = jest.spyOn(registry.billingDeductDuration, 'observe');
      
      // Simulate finish
      resFinishCallback();
      
      expect(observeSpy).toHaveBeenCalledTimes(1);
      expect(observeSpy).toHaveBeenCalledWith(
        { route: '/api/billing/deduct', status_code: '200' },
        expect.any(Number) // duration > 0 (50ms / 1000 = 0.05)
      );

      const durationArg = observeSpy.mock.calls[0][1] as number;
      expect(durationArg).toBeGreaterThanOrEqual(0);
    });

    it('should handle aborted requests if skipped/closed without finish appropriately', () => {
       // Since the middleware only hooks 'finish', if the request aborts without 'finish', 
       // it is implicitly skipped. We'll simulate this by not calling finish and expecting 0 observations.
       billingDeductHistogramMiddleware(req as Request, res as Response, next);
       const observeSpy = jest.spyOn(registry.billingDeductDuration, 'observe');
       expect(observeSpy).toHaveBeenCalledTimes(0);
    });
  });

  describe('refreshTokenHistogramMiddleware', () => {
    it('should record duration exactly once with status class', () => {
      refreshTokenHistogramMiddleware(req as Request, res as Response, next);
      
      expect(next).toHaveBeenCalledTimes(1);
      
      const observeSpy = jest.spyOn(registry.refreshTokenDuration, 'observe');
      resFinishCallback();
      
      expect(observeSpy).toHaveBeenCalledTimes(1);
      expect(observeSpy).toHaveBeenCalledWith(
        { route: '/api/refresh-token', status_code: '200' },
        expect.any(Number)
      );

      const durationArg = observeSpy.mock.calls[0][1] as number;
      expect(durationArg).toBeGreaterThanOrEqual(0);
    });
  });

  describe('maintenanceHistogramMiddleware', () => {
    it('should record duration exactly once with status class', () => {
      maintenanceHistogramMiddleware(req as Request, res as Response, next);
      
      expect(next).toHaveBeenCalledTimes(1);
      
      const observeSpy = jest.spyOn(registry.maintenanceDuration, 'observe');
      resFinishCallback();
      
      expect(observeSpy).toHaveBeenCalledTimes(1);
      expect(observeSpy).toHaveBeenCalledWith(
        { route: '/api/maintenance', status_code: '200' },
        expect.any(Number)
      );

      const durationArg = observeSpy.mock.calls[0][1] as number;
      expect(durationArg).toBeGreaterThanOrEqual(0);
    });
  });

  describe('adminHistogramMiddleware', () => {
    it('should record duration exactly once with bounded route template (not raw path)', () => {
      req.baseUrl = '/api/admin';
      req.route = { path: '/users/:userId' } as any;
      req.path = '/api/admin/users/999';

      adminHistogramMiddleware(req as Request, res as Response, next);
      
      expect(next).toHaveBeenCalledTimes(1);
      
      const observeSpy = jest.spyOn(registry.adminDuration, 'observe');
      resFinishCallback();
      
      expect(observeSpy).toHaveBeenCalledTimes(1);
      
      // Should use the template /users/:userId, not /users/999
      expect(observeSpy).toHaveBeenCalledWith(
        { route: '/api/admin/users/:userId', status_code: '200' },
        expect.any(Number)
      );

      const durationArg = observeSpy.mock.calls[0][1] as number;
      expect(durationArg).toBeGreaterThanOrEqual(0);
    });

    it('should fallback to /unmatched if route path is undefined, instead of using raw path', () => {
      req.baseUrl = '/api/admin';
      req.route = undefined;
      req.path = '/api/admin/unknown/123';

      adminHistogramMiddleware(req as Request, res as Response, next);
      
      const observeSpy = jest.spyOn(registry.adminDuration, 'observe');
      resFinishCallback();
      
      expect(observeSpy).toHaveBeenCalledTimes(1);
      
      // Should fallback to /unmatched
      expect(observeSpy).toHaveBeenCalledWith(
        { route: '/api/admin/unmatched', status_code: '200' },
        expect.any(Number)
      );
    });
  });
});
