import test from 'node:test'
import assert from 'node:assert/strict'
import { slug } from '../src/slug.js'

test('creates a stable slug from a title', () => {
  assert.equal(slug('  Hello, World!  '), 'hello-world')
  assert.equal(slug('Café au lait'), 'cafe-au-lait')
  assert.equal(slug('one---two'), 'one-two')
})
