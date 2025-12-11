const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function getArg(name, defaultValue = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((v) => v.startsWith(prefix));
  if (arg) return arg.slice(prefix.length);
  return defaultValue;
}

function requireArg(name) {
  const val = getArg(name);
  if (!val) {
    throw new Error(`missing --${name}=...`);
  }
  return val;
}

async function encryptFile(inputPath, outputPath, publicKeyPath) {
  const data = await fs.readFile(inputPath);
  const publicKey = await fs.readFile(publicKeyPath, 'utf8');

  const aesKey = crypto.randomBytes(32); // AES-256
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  const wrappedKey = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    },
    aesKey
  );

  const payload = {
    version: 1,
    algo: 'aes-256-gcm + rsa-oaep-sha256',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    key: wrappedKey.toString('base64'),
    data: encrypted.toString('base64'),
    source: path.basename(inputPath),
    generatedAt: new Date().toISOString()
  };

  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function decryptFile(inputPath, outputPath, privateKeyPath) {
  const payload = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const privateKey = await fs.readFile(privateKeyPath, 'utf8');

  const aesKey = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    },
    Buffer.from(payload.key, 'base64')
  );

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    aesKey,
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'base64')),
    decipher.final()
  ]);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, decrypted);
  return payload;
}

async function main() {
  const mode = getArg('mode', 'encrypt'); // encrypt | decrypt
  const inputPath = requireArg('in');
  const outputPath = getArg('out', mode === 'encrypt' ? `${inputPath}.enc.json` : `${inputPath}.dec`);

  if (mode === 'encrypt') {
    const pubPath = requireArg('pub');
    await encryptFile(inputPath, outputPath, pubPath);
    console.log(`[crypto] encrypted ${inputPath} -> ${outputPath}`);
  } else if (mode === 'decrypt') {
    const privPath = requireArg('priv');
    await decryptFile(inputPath, outputPath, privPath);
    console.log(`[crypto] decrypted ${inputPath} -> ${outputPath}`);
  } else {
    throw new Error('mode must be encrypt or decrypt');
  }
}

main().catch((err) => {
  console.error('[crypto] failed', err);
  process.exitCode = 1;
});
