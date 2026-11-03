const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const ASSET = 'test-book.pdf';

module.exports = function withTestBook(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const source = path.join(config.modRequest.projectRoot, 'assets', ASSET);
      const targetDir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(source, path.join(targetDir, ASSET));
      return config;
    },
  ]);
};
