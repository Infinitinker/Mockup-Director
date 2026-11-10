/**
 * Sizing SVG artwork: the intrinsic size from width, height and viewBox (with their quirks: only quoted
 * attributes count, percentages fall back to the viewBox), and the root tag rewritten to a pixel size.
 */
import { describe, expect, it } from 'vitest';
import { sizeSvgRoot, svgIntrinsicSize } from '../../src/core/svg';

describe('svgIntrinsicSize', () => {
  it('reads a width and height in px or without a unit', () => {
    expect(svgIntrinsicSize('<svg width="100" height="50"></svg>')).toEqual({ width: 100, height: 50 });
    expect(svgIntrinsicSize('<svg width="100px" height=" 50.5 px "></svg>')).toEqual({ width: 100, height: 50.5 });
  });

  it('converts absolute units to CSS px at 96 per inch', () => {
    expect(svgIntrinsicSize('<svg width="72pt" height="36pt">')).toEqual({ width: 96, height: 48 });
    expect(svgIntrinsicSize('<svg width="1in" height="2IN">')).toEqual({ width: 96, height: 192 });
    const metric = svgIntrinsicSize('<svg width="25.4mm" height="2.54cm">');
    expect(metric?.width).toBeCloseTo(96, 9);
    expect(metric?.height).toBeCloseTo(96, 9);
  });

  it('accepts single quotes', () => {
    expect(svgIntrinsicSize("<svg width='10' height='20'>")).toEqual({ width: 10, height: 20 });
  });

  it('uses the viewBox when there is no width or height', () => {
    expect(svgIntrinsicSize('<svg viewBox="0 0 300 150">')).toEqual({ width: 300, height: 150 });
  });

  it('falls back to the viewBox for a percentage size', () => {
    expect(svgIntrinsicSize('<svg width="100%" height="100%" viewBox="0 0 200 100">')).toEqual({
      width: 200,
      height: 100,
    });
  });

  it('keeps the viewBox aspect when only the width or the height is given', () => {
    expect(svgIntrinsicSize('<svg width="400" viewBox="0 0 200 100">')).toEqual({ width: 400, height: 200 });
    expect(svgIntrinsicSize('<svg height="50" viewBox="0 0 200 100">')).toEqual({ width: 100, height: 50 });
  });

  it('reads a viewBox separated by commas', () => {
    expect(svgIntrinsicSize('<svg viewBox="0,0,200,100">')).toEqual({ width: 200, height: 100 });
    expect(svgIntrinsicSize('<svg viewBox=" 0, 0, 200, 100 ">')).toEqual({ width: 200, height: 100 });
  });

  it('ignores a zero or negative width or height', () => {
    expect(svgIntrinsicSize('<svg width="0" height="50">')).toBeNull();
    expect(svgIntrinsicSize('<svg width="-10" height="50">')).toBeNull();
    expect(svgIntrinsicSize('<svg width="0" height="50" viewBox="0 0 200 100">')).toEqual({ width: 100, height: 50 });
  });

  it('ignores a viewBox with a zero side or the wrong number of values', () => {
    expect(svgIntrinsicSize('<svg viewBox="0 0 0 100">')).toBeNull();
    expect(svgIntrinsicSize('<svg viewBox="0 0 100">')).toBeNull();
  });

  it('ignores unquoted attributes', () => {
    expect(svgIntrinsicSize('<svg width=100 height=50>')).toBeNull();
  });

  it('returns null without an svg tag', () => {
    expect(svgIntrinsicSize('<html><body></body></html>')).toBeNull();
    expect(svgIntrinsicSize('')).toBeNull();
  });
});

describe('sizeSvgRoot', () => {
  it('replaces the width and height and keeps an existing viewBox', () => {
    expect(sizeSvgRoot('<svg width="10" height="20" viewBox="0 0 10 20"><rect/></svg>', 100, 200, 10, 20)).toBe(
      '<svg viewBox="0 0 10 20" width="100" height="200"><rect/></svg>',
    );
  });

  it('adds a stretching viewBox from the intrinsic size when there is none', () => {
    expect(sizeSvgRoot('<svg xmlns="http://www.w3.org/2000/svg" width=\'10\' height="20">', 100, 200, 10, 20)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200" viewBox="0 0 10 20" preserveAspectRatio="none">',
    );
  });

  it('keeps a self-closing root self-closing', () => {
    expect(sizeSvgRoot('<svg width="1" height="1"/>', 5, 5, 1, 1)).toBe(
      '<svg width="5" height="5" viewBox="0 0 1 1" preserveAspectRatio="none"/>',
    );
  });

  it('leaves the text outside the root tag alone', () => {
    expect(sizeSvgRoot('<?xml version="1.0"?>\n<svg viewBox="0 0 2 1"><g width="3"/></svg>', 8, 4, 2, 1)).toBe(
      '<?xml version="1.0"?>\n<svg viewBox="0 0 2 1" width="8" height="4"><g width="3"/></svg>',
    );
  });

  it('rewrites the first svg tag in the text, even one in a comment', () => {
    expect(sizeSvgRoot('<!-- <svg> --><svg viewBox="0 0 2 1"></svg>', 8, 4, 2, 1)).toBe(
      '<!-- <svg width="8" height="4" viewBox="0 0 2 1" preserveAspectRatio="none"> --><svg viewBox="0 0 2 1"></svg>',
    );
  });

  it('removes only quoted width and height attributes', () => {
    expect(sizeSvgRoot('<svg width=100 height="50" viewBox="0 0 2 1">', 8, 4, 2, 1)).toBe(
      '<svg width=100 viewBox="0 0 2 1" width="8" height="4">',
    );
  });

  it('returns the text unchanged without an svg tag', () => {
    expect(sizeSvgRoot('<html></html>', 8, 4, 2, 1)).toBe('<html></html>');
  });
});
