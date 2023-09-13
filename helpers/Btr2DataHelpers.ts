import {Buffer} from "buffer";
import {crc32Calc} from "./crc";

export const cleanData = (data: string) => {
  return data.replace(/[^a-zA-Z0-9:;\],-]/g, 'X');
}

export const getDataWithoutHeadersAndCRC = (data: Buffer): string => {
  const startByteIndex = data.indexOf('\x02') + 1;
  const endByteIndex = data.indexOf('\x03');
  // data with crc is between 0x02 and 0x03
  const dataWithCrC = data.slice(startByteIndex, endByteIndex);
  const dataBuffer = Buffer.from(dataWithCrC.slice(0, dataWithCrC.length - 8));
  return Buffer.from(dataBuffer).toString('ascii');
}

export const getChipNumberFromDataString = (data: string): string => {
  const dataStringArray = data.split(';');
  const chipNumberInverse = dataStringArray[7]; // ex. FB2D770100004000
  const splitChipNumberToHex = chipNumberInverse.match(/.{1,2}/g); // ex. [FB, 2D, 77, 01, 00, 00, 40, 00]
  const splitChipNumberToHexReversed = splitChipNumberToHex?.reverse(); // ex. [00, 40, 00, 01, 77, 2D, FB]
  // revers string order of each hex value
  const chipNumber = splitChipNumberToHexReversed?.map((hex) => {
    return hex.match(/.{1,2}/g)?.reverse()?.join('');
  }).join('');

  console.log("chipNumber: ", chipNumber, 'from: ', chipNumberInverse);
  if (!chipNumber) {
    throw new Error('Could not parse chip number from data string');
  }
  return chipNumber;
}

export const getCurrentDateTimeString = (): string => {
  // format: 2015-7-21;9:34:11
  const date = new Date();
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const dayOfMonth = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();

  const dateString = `${year}-${month}-${dayOfMonth}`;
  const timeString = `${hours}:${minutes}:${seconds}`;

  return `${dateString};${timeString}`;
}

export const prepareResponseBuffer = (data: string): Buffer => {
  const cleanDataString = cleanData(data);
  // split by ;
  const dataStringArray = cleanDataString.split(';');
  const serverMacAddress = dataStringArray[2];
  const packetIndex = dataStringArray[3];


  // create new buffer with length 128
  const responseBuffer = Buffer.alloc(128);
  let i = 0;

  // write start byte 0x02
  responseBuffer.writeUInt8(0x02, i);
  i += 1;

  // write version (string "1") to buffer
  responseBuffer.write('1', i, 1, 'ascii');
  i += 1;
  // write ; to buffer
  responseBuffer.write(';', i, 1, 'ascii');
  i += 1;

  // write kind (string "R") to buffer
  responseBuffer.write('R', i, 1, 'ascii');
  i += 1;
  // write ; to buffer
  responseBuffer.write(';', i, 1, 'ascii');
  i += 1;

  // write client mac address to buffer | does not need to be correct
  const macAddress = "123456789ABC";
  responseBuffer.write(macAddress, i, macAddress.length, 'ascii');
  i += macAddress.length;
  // write ; to buffer
  responseBuffer.write(';', i, 1, 'ascii');
  i += 1;

  // write index to buffer
  const dataIndex = packetIndex;
  responseBuffer.write(dataIndex, i, dataIndex.length, 'ascii');
  i += dataIndex.length;
  // write ; to buffer
  responseBuffer.write(';', i, 1, 'ascii');
  i += 1;

  // write date to buffer
  const dateTimeString = getCurrentDateTimeString();
  responseBuffer.write(dateTimeString, i, dateTimeString.length, 'ascii');
  i += dateTimeString.length;
  // write ; to buffer
  responseBuffer.write(';', i, 1, 'ascii');
  i += 1;

  // if transponder write type, identifier, checksum and reserved with ; between, else just write ;;;;
  // just write ;;;; for now
  responseBuffer.write(';;;;', i, 4, 'ascii');
  i += 4;

  // if barcode write aim, identifier, reserver with ; between, else just write ;;;
  // just write ;;; for now
  responseBuffer.write(';;;', i, 3, 'ascii');
  i += 3;

  // if response !== null
  // write response to buffer
  const responseMac = serverMacAddress;
  responseBuffer.write(responseMac, i, responseMac.length, 'ascii');
  i += responseMac.length;
  // write ; to buffer
  responseBuffer.write(';', i, 1, 'ascii');
  i += 1;

  // write response index to buffer
  const responseIndex = packetIndex
  responseBuffer.write(responseIndex, i, responseIndex.length, 'ascii');
  i += responseIndex.length;
  // write ;;; to buffer
  responseBuffer.write(';;;', i, 3, 'ascii');
  i += 3;

  // calculate CRC32
  const crcDataBegin = 1;
  const crcDataEnd = i;

  const crc32 = crc32Calc(responseBuffer.slice(crcDataBegin, crcDataEnd));
  console.log("crc32: ", crc32.toString(16));

  // write crc as hex to buffer
  responseBuffer.write(crc32.toString(16).toUpperCase().padStart(8, '0'), i, 8, 'ascii');
  i += 8;

  // write end byte 0x03
  responseBuffer.writeUInt8(0x03, i);
  i += 1;

  // create new buffer with length i and copy data from responseBuffer
  const responseBufferFinal = Buffer.alloc(i);
  responseBuffer.copy(responseBufferFinal, 0, 0, i);

  // print content of response buffer as ascii
  console.log("responseBufferFinal: ", Buffer.from(responseBufferFinal).toString('ascii'));
  return responseBufferFinal;
}