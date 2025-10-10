/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("node:fs/promises");
const path = require("node:path");
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch");

async function compareImageFiles(baselinePath, actualPath, diffPath, options = {}) {
  const [baselineBuffer, actualBuffer] = await Promise.all([
    fs.readFile(baselinePath),
    fs.readFile(actualPath),
  ]);

  const baselinePng = PNG.sync.read(baselineBuffer);
  const actualPng = PNG.sync.read(actualBuffer);

  if (baselinePng.width !== actualPng.width || baselinePng.height !== actualPng.height) {
    throw new Error(
      `Image dimensions differ: baseline=${baselinePng.width}x${baselinePng.height}, actual=${actualPng.width}x${actualPng.height}`,
    );
  }

  const diffPng = new PNG({ width: baselinePng.width, height: baselinePng.height });
  const diffPixels = pixelmatch(
    baselinePng.data,
    actualPng.data,
    diffPng.data,
    baselinePng.width,
    baselinePng.height,
    {
      threshold: options.threshold ?? 0.08,
      includeAA: options.includeAntiAliasing ?? true,
      alpha: 0.5,
    },
  );

  await fs.mkdir(path.dirname(diffPath), { recursive: true });
  await fs.writeFile(diffPath, PNG.sync.write(diffPng));

  const totalPixels = baselinePng.width * baselinePng.height;

  return {
    diffPixels,
    diffRatio: totalPixels === 0 ? 0 : diffPixels / totalPixels,
    width: baselinePng.width,
    height: baselinePng.height,
  };
}

module.exports = {
  compareImageFiles,
};
