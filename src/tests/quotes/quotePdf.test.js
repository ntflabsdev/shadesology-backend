'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildQuotePdf } = require('../../workers/pdfWorker');

describe('Quote PDF generation', () => {
  it('writes valid object offsets and creates multiple pages for long quote details', () => {
    const pdf = buildQuotePdf({
      referenceNumber: 'QT-2026-0042',
      status: 'quoted',
      currency: 'USD',
      createdAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-10-31T00:00:00Z'),
      guestContact: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com' },
      projectDescription: 'Detailed project requirements. '.repeat(400),
      items: [{ productName: 'Cassita Pergola', quantity: 2, selectedOptions: new Map([['Frame', 'Matte White']]) }],
    });
    const source = pdf.toString('ascii');

    assert.ok(source.startsWith('%PDF-1.4'));
    assert.match(source, /SHADESOLOGY\.COM/);
    assert.match(source, /\/Count [2-9]\d*/);

    const xrefOffset = Number(source.match(/startxref\n(\d+)/)?.[1]);
    assert.equal(source.slice(xrefOffset, xrefOffset + 5), 'xref\n');
    const xrefHeader = source.slice(xrefOffset).match(/^xref\n0 (\d+)\n/);
    assert.ok(xrefHeader);
    const objectCount = Number(xrefHeader[1]);
    const xrefEntries = source.slice(xrefOffset).split('\n').slice(2, objectCount + 2);

    for (let objectId = 1; objectId < objectCount; objectId += 1) {
      const offset = Number(xrefEntries[objectId].slice(0, 10));
      assert.ok(source.startsWith(`${objectId} 0 obj\n`, offset), `xref offset for object ${objectId}`);
    }
  });

  it('escapes user-provided PDF delimiters in quote text', () => {
    const source = buildQuotePdf({
      referenceNumber: 'QT-2026-0043',
      status: 'quoted',
      items: [{ productName: 'Shade (special) \\ model', quantity: 1 }],
    }).toString('ascii');

    assert.ok(source.includes('Shade \\(special\\) \\\\ model'));
  });
});
