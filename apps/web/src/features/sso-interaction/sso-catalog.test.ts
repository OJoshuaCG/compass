import { loadSsoCatalog } from '@iam/i18n';
import { describe, expect, it } from 'vitest';

import { KNOWN_SCOPES } from './model/scopes';

describe('sso catalog', () => {
  it('describes every known scope with a label and a description in both languages', async () => {
    const catalog = await loadSsoCatalog();
    for (const locale of ['es-MX', 'en-US'] as const) {
      for (const scope of KNOWN_SCOPES) {
        expect(catalog[locale][`scope.${scope}.label`], `${locale} ${scope}`).toBeDefined();
        expect(catalog[locale][`scope.${scope}.description`], `${locale} ${scope}`).toBeDefined();
      }
    }
  });
});
