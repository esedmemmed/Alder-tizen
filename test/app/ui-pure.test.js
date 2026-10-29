import test from 'node:test'
import assert from 'node:assert/strict'
import { qrModules, qrSvg } from '../../src/ui/qr.js'
import { createPinState } from '../../src/ui/pin.js'
import { initialOf } from '../../src/ui/onboarding.js'

test('qr: a sign-in link fits a small version, finder patterns sit in three corners, the svg is one path', () => {
  const m = qrModules('https://link.stremio.com/?code=ABCD&x=1')
  assert.ok(m.length >= 21 && m.length <= 41 && (m.length - 17) % 4 === 0, 'size ' + m.length)
  const n = m.length
  // finder pattern: a 7x7 ring with a dark 3x3 centre
  for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    assert.equal(m[r][c], true); assert.equal(m[r + 3][c + 3], true); assert.equal(m[r + 1][c + 1], false); assert.equal(m[r][c + 6], true)
  }
  assert.equal(m[n - 7][n - 7] === undefined, false)
  const svg = qrSvg('https://link.stremio.com/?code=ABCD&x=1')
  assert.equal((svg.match(/<path/g) || []).length, 1)
  assert.match(svg, /viewBox="0 0 (\d+) \1"/)
  const size = Number(/viewBox="0 0 (\d+)/.exec(svg)[1])
  assert.equal(size, n + 8, 'a 4-module quiet zone each side')
})

test('pin state: digits fill in order, only digits count, four complete it, delete steps back', () => {
  const s = createPinState()
  assert.equal(s.add('1'), 1)
  assert.equal(s.add('x'), 1)
  assert.equal(s.add(2), 2)
  s.add('3')
  assert.equal(s.complete, false)
  s.add('4')
  assert.equal(s.complete, true)
  assert.equal(s.add('5'), 4, 'nothing past the fourth')
  s.backspace()
  assert.equal(s.value, '123')
  s.clear()
  assert.equal(s.value, '')
})

test('initialOf', () => {
  assert.equal(initialOf('enough'), 'E')
  assert.equal(initialOf('  jane'), 'J')
  assert.equal(initialOf(''), '')
  assert.equal(initialOf('émile'), 'É')
})
