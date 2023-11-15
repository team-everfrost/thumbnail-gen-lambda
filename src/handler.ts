import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';
import { fromBuffer } from 'pdf2pic';
import * as pdfjsLib from 'pdfjs-dist';
import sharp from 'sharp';

const SOURCE_BUCKET = 'remak-documents';
const DEST_BUCKET = 'remak-thumbnails';
const s3Client = new S3Client({ region: 'ap-northeast-2' });

const loadS3 = async (key) => {
  const command = new GetObjectCommand({
    Bucket: SOURCE_BUCKET,
    Key: key,
  });
  const response = await s3Client.send(command);

  const byteArray = await response.Body?.transformToByteArray();

  if (!byteArray) {
    throw new Error('Failed to read file');
  }

  return byteArray;
};

const saveS3 = async (key, body) => {
  const command = new PutObjectCommand({
    Bucket: DEST_BUCKET,
    Key: key,
    Body: body,
    ContentType: 'image/webp',
  });
  await s3Client.send(command);
};

const imgThumbnail = async (byteArray) => {
  const originalWidth = (await sharp(byteArray).metadata()).width;
  const originalHeight = (await sharp(byteArray).metadata()).height;

  const thumbnail = await sharp(byteArray)
    .rotate()
    .resize({
      width: 1440 > originalWidth ? originalWidth : 1440,
      height: 1440 > originalHeight ? originalHeight : 1440,
      fit: 'outside',
    })
    .toFormat('webp')
    .toBuffer();

  return thumbnail;
};

const pdfThumbnail = async (byteArray) => {
  const tempFileName = randomBytes(16).toString('hex');

  const buffer = Buffer.from(byteArray);

  const getPdfSize = async (byteArray) => {
    const pdf = await pdfjsLib.getDocument(byteArray).promise;
    const page = await pdf.getPage(1); // 첫 번째 페이지 정보를 가져옵니다.
    const viewport = page.getViewport({ scale: 1 }); // 기본 스케일로 뷰포트를 가져옵니다.

    return {
      width: viewport.width,
      height: viewport.height,
    };
  };

  const { width, height } = await getPdfSize(byteArray);

  const options = {
    density: 200,
    saveFilename: tempFileName,
    savePath: '/tmp',
    format: 'png',
    width,
    height,
  };

  const storeAsImage = fromBuffer(buffer, options);
  const pageToConvertAsImage = 1;

  await storeAsImage(pageToConvertAsImage, {
    responseType: 'image',
  });

  const thumbnail = await sharp(`/tmp/${tempFileName}.1.png`)
    .resize({
      width: 1440 > width ? width : 1440,
      height: 1440 > height ? height : 1440,
      fit: 'outside',
    })
    .toFormat('webp')
    .toBuffer();

  return thumbnail;
};

export const handler = async (event) => {
  for (const record of event.Records) {
    const { key } = record.s3.object;
    const eventType = record.eventName;

    if (eventType === 'ObjectCreated:Put') {
      const byteArray = await loadS3(key);

      console.log('New file added: ', key);

      // check if the file is an image
      const fileType = await import('file-type');
      const fileTypeResult = await fileType.fileTypeFromBuffer(byteArray);

      if (!fileTypeResult) continue;

      console.log('File type: ', fileTypeResult.mime);

      if (fileTypeResult.mime.split('/')[0] === 'image') {
        const thumbnail = await imgThumbnail(byteArray);
        await saveS3(key, thumbnail);
      }
      if (fileTypeResult.mime.split('/')[1] === 'pdf') {
        const thumbnail = await pdfThumbnail(byteArray);
        await saveS3(key, thumbnail);
      }
    }

    if (eventType === 'ObjectRemoved:Delete') {
      console.log('File deleted: ', key);

      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: DEST_BUCKET,
          Key: key,
        }),
      );
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'success',
    }),
  };
};
