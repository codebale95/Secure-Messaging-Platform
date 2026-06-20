import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export function getOrGenerateKeyPair(username) {
    const keyFile = path.resolve(`.keys_${username}.json`);
    if (fs.existsSync(keyFile)) {
        try {
            return JSON.parse(fs.readFileSync(keyFile, 'utf8'));
        } catch (e) {}
    }
    
    const ecdh = crypto.createECDH('secp256k1');
    ecdh.generateKeys();
    const keys = {
        privateKey: ecdh.getPrivateKey('hex'),
        publicKey: ecdh.getPublicKey('hex')
    };
    
    fs.writeFileSync(keyFile, JSON.stringify(keys));
    return keys;
}

export function computeSharedSecret(myPrivateKeyHex, theirPublicKeyHex) {
    const ecdh = crypto.createECDH('secp256k1');
    ecdh.setPrivateKey(myPrivateKeyHex, 'hex');
    const sharedSecret = ecdh.computeSecret(theirPublicKeyHex, 'hex');
    return sharedSecret;
}

export function encryptMessage(text, sharedKey) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', sharedKey, iv);
    
    let ciphertext = cipher.update(text, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${ciphertext}:${authTag.toString('hex')}`;
}

export function decryptMessage(encryptedData, sharedKey) {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const ciphertext = parts[1];
    const authTag = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', sharedKey, iv);
    decipher.setAuthTag(authTag);
    
    let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
}
