import { expect, test, describe } from 'bun:test';
import { parsePoemContent } from './poem-parser';

describe('parsePoemContent', () => {
  test('should extract text from simple paragraphs', () => {
    const html = `
      <p>Line 1</p>
      <p>Line 2</p>
    `;
    const expected = 'Line 1\n\nLine 2';
    expect(parsePoemContent(html)).toBe(expected);
  });

  test('should handle <br> tags correctly within paragraphs', () => {
    const html = `
      <p>Line 1<br>Line 2</p>
      <p>Line 3<br>Line 4</p>
    `;
    const expected = 'Line 1\nLine 2\n\nLine 3\nLine 4';
    expect(parsePoemContent(html)).toBe(expected);
  });

  test('should ignore empty paragraphs', () => {
    const html = `
      <p>Line 1</p>
      <p></p>
      <p>Line 2</p>
    `;
    const expected = 'Line 1\n\nLine 2';
    expect(parsePoemContent(html)).toBe(expected);
  });

  test('should trim whitespace', () => {
    const html = `
      <p>  Line 1  </p>
      <p>  Line 2  </p>
    `;
    const expected = 'Line 1\n\nLine 2';
    expect(parsePoemContent(html)).toBe(expected);
  });

  test('should handle div tags as paragraphs if p tags are missing', () => {
    const html = `
      <div class="stanza">Line 1</div>
      <div class="stanza">Line 2</div>
    `;
    const expected = 'Line 1\n\nLine 2';
    expect(parsePoemContent(html)).toBe(expected);
  });
});
