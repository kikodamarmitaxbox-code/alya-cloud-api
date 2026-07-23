const logger = require('./logger');

class RateLimiter {
  constructor(options) {
    this.windowMs = options.windowMs || 15 * 60 * 1000;
    this.max = options.max || 100;
    this.message = options.message || { error: 'Muitas solicitacoes. Tente novamente em alguns minutos.' };
    this.requests = new Map();
    
    setInterval(() => this.cleanup(), this.windowMs);
  }

  getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() || 
           req.socket.remoteAddress || 
           'unknown';
  }

  cleanup() {
    const now = Date.now();
    for (const [ip, data] of this.requests.entries()) {
      if (now - data.resetTime > this.windowMs) {
        this.requests.delete(ip);
      }
    }
  }

  check(req, res) {
    const ip = this.getClientIp(req);
    const now = Date.now();
    
    if (!this.requests.has(ip)) {
      this.requests.set(ip, {
        count: 1,
        resetTime: now + this.windowMs
      });
      return true;
    }
    
    const data = this.requests.get(ip);
    
    if (now > data.resetTime) {
      data.count = 1;
      data.resetTime = now + this.windowMs;
      return true;
    }
    
    if (data.count >= this.max) {
      logger.warn(`Rate limit exceeded for IP: ${ip}`);
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(this.message));
      return false;
    }
    
    data.count++;
    return true;
  }
}

const apiLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Muitas solicitacoes. Tente novamente em alguns minutos.' }
});

const authLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' }
});

module.exports = {
  RateLimiter,
  apiLimiter,
  authLimiter
};
