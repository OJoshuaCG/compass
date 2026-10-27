import { describe, expect, it } from 'vitest';

import { describeDevice } from './describe-device';

const UA = {
  chromeLinux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:130.0) Gecko/20100101 Firefox/130.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
};

describe('describeDevice', () => {
  it('summarizes browser and system briefly', () => {
    expect(describeDevice(UA.chromeLinux)).toBe('Chrome · Linux');
    expect(describeDevice(UA.edgeWindows)).toBe('Edge · Windows');
    expect(describeDevice(UA.firefoxMac)).toBe('Firefox · macOS');
    expect(describeDevice(UA.safariIphone)).toBe('Safari · iOS');
  });

  it('does not mistake Android for Linux nor Chrome-based browsers for Safari', () => {
    expect(describeDevice(UA.chromeAndroid)).toBe('Chrome · Android');
  });

  it('keeps a partial result and returns undefined when nothing is recognized', () => {
    expect(describeDevice('curl/8.0')).toBeUndefined();
    expect(describeDevice('Firefox/130.0')).toBe('Firefox');
    expect(describeDevice(null)).toBeUndefined();
    expect(describeDevice('')).toBeUndefined();
  });
});
