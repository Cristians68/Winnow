import { describe, it, expect } from 'vitest';
import { isDevEndpoint } from '../src/shared/settings.js';

// The dev endpoint field lives inside a privacy tool. If it accepted arbitrary
// URLs it would be a data-exfiltration primitive: anything that could write a
// setting could redirect page data to a host of its choosing.
describe('dev endpoint restriction', () => {
  it('accepts loopback addresses', () => {
    for (const url of [
      'http://localhost:8787/v1/analyse',
      'http://127.0.0.1:8787/v1/analyse',
      'https://localhost:8787/v1/analyse',
    ]) {
      expect(isDevEndpoint(url)).toBe(true);
    }
  });

  it('refuses every non-loopback host', () => {
    for (const url of [
      'https://evil.example/v1/analyse',
      'http://localhost.evil.example/v1/analyse',
      'http://127.0.0.1.evil.example/x',
      'http://169.254.169.254/latest/meta-data',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(isDevEndpoint(url)).toBe(false);
    }
  });
});
