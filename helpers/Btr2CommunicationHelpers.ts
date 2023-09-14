import {BleCharacteristic, DISCOVER_SERVICES_DELAY, READ_WAIT_DELAY, SERVICES} from "../constants/Btr2Constants";
import {Device} from "react-native-ble-plx";
import {Buffer} from "buffer";
import {sleep} from "./sleep";
import {consoleLogBlePlxObject, discoverServicesAndCharacteristics} from "./BlePlxHelpers";
import {getDataWithoutHeadersAndCRC, prepareResponseBuffer} from "./Btr2DataHelpers";
import {calculateCRC32OnReceivedBtr2Data, parseCRC32FromBtr2Data} from "./crc";

export const verifyAllCharacteristicsAreDiscovered = (
  discoveredCharacteristics: BleCharacteristic[]
): boolean => {
  const requiredCharacteristics = [
    SERVICES.MOBA_BTR2.CHARACTERISTICS.READ_CONTROL_POINT_32,
    SERVICES.MOBA_BTR2.CHARACTERISTICS.READ_OBJECT_34,
    SERVICES.MOBA_BTR2.CHARACTERISTICS.WRITE_CONTROL_POINT_36,
    SERVICES.MOBA_BTR2.CHARACTERISTICS.WRITE_OBJECT_38,
    SERVICES.MOBA_BTR2.CHARACTERISTICS.BONDING_CHARACTERISTIC,
  ];
  const discoveredCharacteristicsUUIDs = discoveredCharacteristics.map((c) => c.characteristicUUID);
  const missingCharacteristics = requiredCharacteristics.filter((c) => !discoveredCharacteristicsUUIDs.includes(c));
  if (missingCharacteristics.length > 0) {
    console.log("missing characteristics: ", missingCharacteristics);
    return false;
  }
  return true;
}

export const establishBtr2Bond = async (device: Device): Promise<void> => {
  console.log("establishing pairing...");
  try {
    await device.readCharacteristicForService(
      SERVICES.MOBA_BTR2.SERVICE_UUID,
      SERVICES.MOBA_BTR2.CHARACTERISTICS.BONDING_CHARACTERISTIC,
    );
  } catch (e) {
    return
  }
}

export const connectToBtr2Device = async (device: Device, skipBonding?: boolean): Promise<Device> => {
  // print device advertisement data
  // const advertisementData = Buffer.from(device.manufacturerData || '', 'base64').toString('utf-8');
  // console.log(`xxx${advertisementData}xxx`);

  try {
    const connectedDevice = await device.connect({
        timeout: 5000,
        autoConnect: false,
      }
    );

    await sleep(DISCOVER_SERVICES_DELAY);
    const discoveredCharacteristics = await discoverServicesAndCharacteristics(connectedDevice);
    if (!verifyAllCharacteristicsAreDiscovered(discoveredCharacteristics)) {
      console.log("Some required characteristics weren't discovered!");
      return Promise.reject(Error('Some required characteristics weren\'t discovered!'));
    }
    // await sleep(500);

    // TODO find out if device is in pairing mode
    // if so, establish bond, else skip
    // if not skipped when not in pairing mode, connection will fail

    if (!skipBonding) {
      await establishBtr2Bond(connectedDevice);
      await sleep(500);
      return await connectToBtr2Device(device, true);
    } else {
      console.log(`Connected to ${connectedDevice.name} (${connectedDevice.id})`)
      return Promise.resolve(connectedDevice);
    }
  } catch (e) {
    return Promise.reject(Error('Could not connect to the device'));
  }
};

export const acknowledgeDataRead = async (device?: Device, data?: string): Promise<boolean> => {
  if (!device || !data) {
    console.log("device or data not set");
    return Promise.reject(new Error("device or data not set"));
  }

  let responseBuffer = prepareResponseBuffer(data);
  await sleep(READ_WAIT_DELAY);

  // split data to 20 byte chunks
  const chunkSize = 20;
  const dataLength = responseBuffer.length;

  console.log("response data length", dataLength);


  try {
    for (let i = 0; i < dataLength; i += chunkSize) {  // i is pointer index
      const chunkToSend = responseBuffer.slice(i, Math.min(i + chunkSize, dataLength));

      console.log(`sending chunk ${i}/${dataLength}`)

      // write to handle 38, length and index
      await device.writeCharacteristicWithResponseForService(
        SERVICES.MOBA_BTR2.SERVICE_UUID,
        SERVICES.MOBA_BTR2.CHARACTERISTICS.WRITE_CONTROL_POINT_36,
        Buffer.from([dataLength, i]).toString('base64'),
      )

      // write current chunk to handle 38 (write object)
      await device.writeCharacteristicWithResponseForService(
        SERVICES.MOBA_BTR2.SERVICE_UUID,
        SERVICES.MOBA_BTR2.CHARACTERISTICS.WRITE_OBJECT_38,
        Buffer.from(chunkToSend).toString('base64'),
      )
      console.log(`wrote chunk ${i}/${dataLength} to handle 38`)
    }

    await device.writeCharacteristicWithResponseForService(
      SERVICES.MOBA_BTR2.SERVICE_UUID,
      SERVICES.MOBA_BTR2.CHARACTERISTICS.WRITE_CONTROL_POINT_36,
      Buffer.from([dataLength, dataLength]).toString('base64'),
    )
    return Promise.resolve(true);
  } catch (e) {
    console.log("error acknowledging data read", e)
    return Promise.reject(new Error("error acknowledging data read"));
  }
}

export const readDataFromBTR2 = async (device?: Device): Promise<string> => {
  if (!device) {
    return Promise.reject(new Error("device not set"));
  }
  console.log("reading data from BTR2");
  // read from handle 32 (read control point to get length)
  let readLenCharacteristics;
  try {
    readLenCharacteristics = await device.readCharacteristicForService(
      SERVICES.MOBA_BTR2.SERVICE_UUID,
      SERVICES.MOBA_BTR2.CHARACTERISTICS.READ_CONTROL_POINT_32,
    );
  } catch (e) {
    return Promise.reject(e);
  }
  // consoleLogBlePlxObject(readLenCharacteristics, 'read control point');

  // get len from base64
  const len = Buffer.from(readLenCharacteristics.value || '', 'base64').readUInt8(0);
  const readPointer = Buffer.from(readLenCharacteristics.value || '', 'base64').readUInt8(1);

  if (len === 0) {
    return Promise.reject(new Error("No data left to read"));
  }

  let responseLen = readPointer;
  console.log(`len: ${len}, readPointer: ${readPointer}`)

  await device.writeCharacteristicWithResponseForService(
    SERVICES.MOBA_BTR2.SERVICE_UUID,
    SERVICES.MOBA_BTR2.CHARACTERISTICS.READ_CONTROL_POINT_32,
    Buffer.from([len, 0]).toString('base64'),
  )

  // read form handle 34 (read object)
  const readObjectCharacteristics = await device.readCharacteristicForService(
    SERVICES.MOBA_BTR2.SERVICE_UUID,
    SERVICES.MOBA_BTR2.CHARACTERISTICS.READ_OBJECT_34,
  );

  let dataString = "";
  let data: Buffer;
  // decode base64 to string
  let currentDataBuffer = Buffer.from(readObjectCharacteristics.value || '', 'base64');
  let currentDataChunk = Buffer.from(readObjectCharacteristics.value || '', 'base64').toString('ascii');

  dataString = `${dataString}${currentDataChunk}`
  data = currentDataBuffer;

  // console.log("data: ", dataString);
  consoleLogBlePlxObject(readObjectCharacteristics, 'read object');

  responseLen += data.length;
  while (responseLen < len) {
    await device.writeCharacteristicWithResponseForService(
      SERVICES.MOBA_BTR2.SERVICE_UUID,
      SERVICES.MOBA_BTR2.CHARACTERISTICS.READ_CONTROL_POINT_32,
      Buffer.from([len, responseLen]).toString('base64'),
    )
    let charDataResponse = await device.readCharacteristicForService(
      SERVICES.MOBA_BTR2.SERVICE_UUID,
      SERVICES.MOBA_BTR2.CHARACTERISTICS.READ_OBJECT_34,
    );
    currentDataBuffer = Buffer.from(charDataResponse.value || '', 'base64');
    currentDataChunk = Buffer.from(charDataResponse.value || '', 'base64').toString('ascii');

    // console.log("respString: ", currentDataChunk);

    dataString = `${dataString}${currentDataChunk}`
    data = Buffer.concat([data, currentDataBuffer]);
    responseLen = data.length;
    console.log("responseLen: ", responseLen, 'len: ', len);
  }
  // console.log("data: ", dataString);
  // console.log("data: ", data);
  // console.log("data hex", data.toString('hex'));

  const parsedCRC32 = parseCRC32FromBtr2Data(dataString);
  const calculatedCRC32 = calculateCRC32OnReceivedBtr2Data(data);

  console.log(`parsedCRC32: *${parsedCRC32}*, calculatedCRC32: *${calculatedCRC32}*`);


  if (parsedCRC32 !== calculatedCRC32) {
    console.log("CRC32 does not match");
    return Promise.reject(new Error("CRC32 mismatch"));
  } else {
    try {
      await acknowledgeDataRead(device, dataString);
      return Promise.resolve(getDataWithoutHeadersAndCRC(data));
    } catch (e) {
      console.log("error acknowledging data read", e);
      return Promise.reject(new Error("error acknowledging data read"));
    }
  }
}