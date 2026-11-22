const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const source = readFileSync(join(__dirname, '../src/handlers/tools.js'), 'utf8');
const captureSource = source.slice(source.indexOf('const truncateOutput'), source.indexOf('async function closeServer'));
const headSize = 128 * 1024;
const createCapture = new Function('MAX_HEAD_TAIL', 'Buffer', `${captureSource}\nreturn createDownloadOutputCapture;`)(headSize, Buffer);

for (const sizeKiB of [128, 192, 256, 513]) {
    test(`download output at ${sizeKiB} KiB`, () => {
        const size = sizeKiB * 1024;
        const prefixSize = Math.min(headSize - 1, size - 3);
        const output = 'a'.repeat(prefixSize) + 'é' + 'm'.repeat(size - prefixSize - 3) + 'z';
        const capture = createCapture('stderr');
        for (let offset = 0; offset < output.length; offset += 7919) {
            capture.append(output.slice(offset, offset + 7919));
        }

        const result = capture.read();
        assert.equal(result.stderrTotalSize, size);
        const truncated = size > 2 * headSize;
        assert.equal(result.stderrTruncated, truncated);
        const bytes = Buffer.from(output);
        const expected = truncated
            ? bytes.subarray(0, headSize).toString() + `\n...[truncated ${size - 2 * headSize} bytes]...\n` + bytes.subarray(-headSize).toString()
            : output;
        assert.ok(result.stderr === expected, 'retained output should match the byte boundaries');
    });
}
