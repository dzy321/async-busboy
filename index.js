'use strict';

const Busboy = require('busboy');
const fs = require('fs');
const os = require('os');
const path = require('path');

const getDescriptor = Object.getOwnPropertyDescriptor;

module.exports = function (request, options) {
  options = options || {};
  options.headers = request.headers;
  const customOnFile = typeof options.onFile === "function" ? options.onFile : false;
  delete options.onFile;
  const busboy = new Busboy(options);

  return new Promise((resolve, reject) => {
    const fields = {};
    const filePromises = [];

    request.on('close', cleanup);

    busboy
      .on('file', customOnFile || onFile.bind(null, filePromises))
      .on('close', cleanup)
      .on('error', onError)
      .on('end', onEnd)
      .on('finish', onEnd),

    busboy.on('partsLimit', function(){
      const err = new Error('Reach parts limit');
      err.code = 'Request_parts_limit';
      err.status = 413;
      onError(err);
    });

    busboy.on('filesLimit', () => {
      const err = new Error('Reach files limit');
      err.code = 'Request_files_limit';
      err.status = 413;
      onError(err);
    });

    busboy.on('fieldsLimit', () => {
      const err = new Error('Reach fields limit');
      err.code = 'Request_fields_limit';
      err.status = 413;
      onError(err);
    });

    request.pipe(busboy);

    function onError(err) {
      cleanup();
      return reject(err);
    }

    function onEnd(err) {
      if(err) {
        return reject(err);
      }
      if (customOnFile) {
        cleanup();
        resolve({ fields });
      } else {
        Promise.all(filePromises)
          .then((files) => {
            cleanup();
            resolve({fields, files});
          })
          .catch(reject);
      }
    }

    function cleanup() {
      busboy.removeListener('file', onFile);
      busboy.removeListener('close', cleanup);
      busboy.removeListener('end', cleanup);
      busboy.removeListener('error', onEnd);
      busboy.removeListener('partsLimit', onEnd);
      busboy.removeListener('filesLimit', onEnd);
      busboy.removeListener('fieldsLimit', onEnd);
      busboy.removeListener('finish', onEnd);
    }
  });
};

function onFile(filePromises, fieldname, file, filename, encoding, mimetype) {
  const tmpName = file.tmpName = Math.random().toString(16).substring(2) + '-' + filename;
  const saveTo = path.join(os.tmpdir(), path.basename(tmpName));
  const writeStream = fs.createWriteStream(saveTo);

  const filePromise = new Promise((resolve, reject) => writeStream
      .on('open', () => file
        .pipe(writeStream)
        .on('error', reject)
        .on('finish', () => {
          const readStream = fs.createReadStream(saveTo);
          readStream.fieldname = fieldname;
          readStream.filename = filename;
          readStream.transferEncoding = readStream.encoding = encoding;
          readStream.mimeType = readStream.mime = mimetype;
          resolve(readStream);
        })
      )
    .on('error', reject)
    );
  filePromises.push(filePromise);
}
