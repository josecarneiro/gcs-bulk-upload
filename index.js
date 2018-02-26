'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Storage = require('@google-cloud/storage');
const recursiveReaddir = require('recursive-readdir');
const minimatch = require('minimatch');
const mimeTypes = require('mime-types');

module.exports = class Uploader {
  constructor (config) {
    this._defaults = {
      public: false,
      debug: false
    };
    this._config = { ...this._defaults, ...config };
    this._storage = new Storage({
      credentials: this._config.credentials
    });
    this._bucket = this._storage.bucket(this._config.bucket);
  }

  _shuffleArray (array) {
    for (let i = array.length - 1; i > 0; i--) {
      let j = Math.floor(Math.random() * (i + 1));
      [ array[i], array[j] ] = [ array[j], array[i] ];
    }
  };

  _hashFile (origin) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      fs.createReadStream(origin)
      .on('error', reject)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')));
    });
  };

  _log (...args) {
    if (this._config.debug) console.log(...args);
  }

  async fileExists ({ origin, file }) {
    try {
      const metadata = await file.getMetadata();
      const hash = await this._hashFile(origin);
      return metadata[0].md5Hash === hash;
    } catch (error) {
      if (error.code === 404) return false;
      throw error;
    }
  };

  async uploadFile ({ origin, destination }) {
    return new Promise(async (resolve, reject) => {
      const file = this._bucket.file(destination);
      this.fileExists({ origin, file })
      .then(exists => {
        if (exists) {
          this._log('File has already been uploaded. Skipping.');
          resolve();
        } else {
          const contentType = mimeTypes.lookup(origin);
          fs.createReadStream(origin)
          .pipe(file.createWriteStream({
            public: true,
            metadata: {
              contentType
            }
          }))
          .on('error', reject)
          .on('finish', resolve);
        }
      })
      .catch(reject);
    });
  };

  async uploadMultipleFiles (files) {
    try {
      for (let i = 0; i < files.length; i++) {
        this._log(`Uploading file ${ i + 1 } of ${ files.length }`);
        await this.uploadFile(files[i]);
      }
    } catch (error) {
      throw error;
    }
  };

  async getFiles ({ origin, destination, disallow = [], allow = [] }) {
    try {
      let list = await recursiveReaddir(origin);
      this._shuffleArray(list);
      return list
      .filter(item =>
        disallow.length ? !(disallow || []).filter(pattern => minimatch(item, pattern)).length : true
      )
      .filter(item =>
        allow.length ? (allow || []).filter(pattern => minimatch(item, pattern)).length : true
      ).map(item => ({
        origin: item,
        destination: path.join(destination, path.relative(origin, item))
      }));
    } catch (error) {
      throw error;
    }
  }

  async upload (options) {
    const disallow = this._config.disallow;
    const allow = this._config.allow;
    try {
      const files = await this.getFiles({
        ...options,
        disallow,
        allow
      });
      await this.uploadMultipleFiles(files);
    } catch (error) {
      throw error;
    }
  }
};
