import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

const createThumbnail = async (key) => {
  const body = await loadS3(key);
  const thumbnail = await sharp(body).resize(1440).toFormat('webp').toBuffer();
  await saveS3(key, thumbnail);
};

export const handler = async (event) => {
  for (const record of event.Records) {
    const { key } = record.s3.object;
    const eventType = record.eventName;

    if (eventType === 'ObjectCreated:Put') {
      await createThumbnail(key);
    }

    if (eventType === 'ObjectRemoved:Delete') {
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
