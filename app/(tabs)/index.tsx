import {
  Alert,
  Linking,
  Permission,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity
} from 'react-native';
import {Text, View} from '../../components/Themed';

import {BleManager, Characteristic, Device, Service,} from 'react-native-ble-plx';
import {useEffect, useRef, useState} from "react";
import * as Location from 'expo-location';
import * as ExpoDevice from 'expo-device';
import {Buffer} from "buffer";
import useInterval from "../../helpers/useInterval";
import {sleep} from "../../helpers/sleep";
import {crc32Calc} from "../../helpers/crc";

const DISCOVER_SERVICES_DELAY = 500;
const READ_WAIT_DELAY = 300;

const SERVICES = {
  DEVICE_INFO: {
    SERVICE_UUID: "0000180a-0000-1000-8000-00805f9b34fb",
    CHARACTERISTICS: {
      MANUFACTURER_NAME: "00002a29-0000-1000-8000-00805f9b34fb"
    }
  },
  BATTERY: {
    SERVICE_UUID: "0000180f-0000-1000-8000-00805f9b34fb",
    CHARACTERISTICS: {
      BATTERY_LEVEL: "00002a19-0000-1000-8000-00805f9b34fb"
    }
  },
  MOBA_BTR2: {
    SERVICE_UUID: "00001630-1212-efde-1523-785feabcd123",
    CHARACTERISTICS: {
      READ_CONTROL_POINT_32: "00001631-1212-efde-1523-785feabcd123",
      READ_OBJECT_34: "00001632-1212-efde-1523-785feabcd123",
      WRITE_CONTROL_POINT_36: "00001633-1212-efde-1523-785feabcd123",
      WRITE_OBJECT_38: "00001634-1212-efde-1523-785feabcd123",
      BONDING_CHARACTERISTIC: "00001644-1212-efde-1523-785feabcd123",
    }
  }
}

export default function TabOneScreen() {
  const bleManager = useRef<BleManager>();
  const devices = useRef<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device>();

  const [scanningDevices, setScanningDevices] = useState(false);

  useEffect(() => {
    bleManager.current = new BleManager();
  }, []);


  const bluetoothLocationPermissionAndroid = async (): Promise<void> => new Promise<void>(async (resolve) => {
    if (Platform.OS === 'android') {
      const isLocationEnabled = await Location.hasServicesEnabledAsync();
      console.log('location enabled', isLocationEnabled);
      console.log(ExpoDevice.platformApiLevel);
      const requiresBluetoothPermissions = Platform.OS === 'android'
        && (ExpoDevice.platformApiLevel === null || ExpoDevice.platformApiLevel >= 31);

      const requiredPermissions: Array<Permission> = [];
      const hasFineLocationPermission = await PermissionsAndroid.check('android.permission.ACCESS_FINE_LOCATION');
      if (!hasFineLocationPermission) {
        requiredPermissions.push('android.permission.ACCESS_FINE_LOCATION');
      }
      const hasBluetoothScanPermission = await PermissionsAndroid.check('android.permission.BLUETOOTH_SCAN');
      if (!hasBluetoothScanPermission && requiresBluetoothPermissions) {
        requiredPermissions.push('android.permission.BLUETOOTH_SCAN');
      }
      const hasBluetoothConnectPermission = await PermissionsAndroid.check('android.permission.BLUETOOTH_CONNECT');
      if (!hasBluetoothConnectPermission && requiresBluetoothPermissions) {
        requiredPermissions.push('android.permission.BLUETOOTH_CONNECT');
      }

      if (requiredPermissions.length > 0) {
        Alert.alert(
          'Bluetooth permission',
          'App requires bluetooth and location permissions to find nearby devices',
          [
            {
              text: 'OK',
              onPress: () => PermissionsAndroid.requestMultiple(requiredPermissions).then(
                (granted) => {
                  console.log('granted: ', granted);
                  resolve();
                },
              ),
            },
          ],
        );
      } else {
        resolve();
      }
    } else {
      resolve();
    }
  });

  const showBluetoothDisabledAlert = () => {
    Alert.alert(
      'Bluetooth is turned off',
      'Turn on Bluetooth to allow Awake to find nearby batteries',
      [
        {text: 'Settings', onPress: () => Linking.openURL('App-Prefs:Bluetooth')},
        // { text: 'Settings', onPress: () => Linking.openSettings() },
        {
          text: 'Cancel',
          onPress: () => console.log('Cancel Pressed'),
          style: 'cancel',
        },
      ],
    );
  };

  const addDevice = (device: Device) => {
    if (device && device.name?.includes("MOBA")) {
      console.log('Found device: ', device.name, device.serviceUUIDs);
      if (devices.current.find((x) => x.id === device.id)) {
        console.log('Already found this device');
        // replace device
        devices.current = [...devices.current.map((d) => (d.id === device.id ? device : d))];
        return;
      } else {
        devices.current = [...devices.current, device];
      }
    }
  };

  const startDeviceScan = async () => {
    stopDeviceScan();
    setScanningDevices(true);
    devices.current = [];
    console.log('Scanning devices');
    enableBluetooth().then();
    bleManager.current?.startDeviceScan(null, {
      // allowDuplicates: false,
      allowDuplicates: true,
    }, (error, device) => {
      if (error) {
        console.error(error)
      } else if (device) {
        addDevice(device);
      }
    });
  };

  const stopDeviceScan = () => {
    // console.trace('stopDeviceScan');
    console.log(
      devices.current.map((d) => d.id),
    )
    bleManager.current?.stopDeviceScan();
    setScanningDevices(false);
  };

  const enableBluetooth = async () => {
    await bluetoothLocationPermissionAndroid();

    const isLocationEnabled = await Location.hasServicesEnabledAsync();
    console.log('location enabled', isLocationEnabled);
    if (Platform.OS === 'android' && !isLocationEnabled) {
      Alert.alert(
        'Enable Location',
        'App requires enabled location services on your device to find nearby devices',
        [
          {
            text: 'OK',
          },
        ],
      );
    }
    bleManager.current?.state().then(async (state) => {
      if (state !== 'PoweredOn') {
        if (Platform.OS === 'ios') {
          showBluetoothDisabledAlert();
        } else {
          await bleManager.current?.enable();
        }
        const subscription = bleManager.current?.onStateChange((subscriptionState) => {
          if (subscriptionState === 'PoweredOn') {
            startDeviceScan();
            subscription?.remove();
          }
        }, true);
      }
    });
  };

  const consoleLogBlePlxObject = (bleObject: Service | Characteristic | Device, tag?: string) => {
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const {_manager, ...x} = bleObject;
    if (tag) console.log(`${tag}:`);
    console.log(x);
  };

  const discoverServicesAndCharacteristics = async (device: Device) => {
    device.discoverAllServicesAndCharacteristics()
      .then((d) => d.services()
        .then((services) => {
          services.forEach((service) => {
            // consoleLogBlePlxObject(service, 'service');
            console.log('characteristics:');
            service.characteristics().then((characteristics) => {
              characteristics.forEach((characteristic) => {
                // consoleLogBlePlxObject(characteristic);
              });
            });
          });
        }));
  };

  const establishBond = async (device: Device): Promise<void> => {
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

  const connectToDevice = async (device: Device, forceReconnect?: boolean): Promise<Device> => {
    // print device advertisement data
    const advertisementData = Buffer.from(device.manufacturerData || '', 'base64').toString('utf-8');
    console.log(`xxx${advertisementData}xxx`);
    const isConnected = await device.isConnected();
    if (isConnected && !forceReconnect) {
      // console.log('is connected: ', isConnected);
      return Promise.resolve(device);
    }
    if (isConnected && forceReconnect) {
      try {
        await device.cancelConnection();
      } catch (e) {
        console.warn('problem disconnection from device', e);
      }
    }
    try {
      const connectedDevice = await device.connect({
          timeout: 5000,
          autoConnect: false,
        }
      );


      await sleep(DISCOVER_SERVICES_DELAY);
      await discoverServicesAndCharacteristics(connectedDevice);
      await sleep(3000);

      // TODO find out if device is in pairing mode
      // if so, establish bond, else skip
      // if not skipped when not in pairing mode, connection will fail

      // await establishBond(connectedDevice);
      // return await connectedDevice.discoverAllServicesAndCharacteristics();
      setConnectedDevice(connectedDevice);
      return connectedDevice;
    } catch (e) {
      return Promise.reject(Error('Could not connect to the device'));
    }
  };


  const [scannerDevices, setScannerDevices] = useState<Device[]>([]);

  const cleanData = (data: string) => {
    return data.replace(/[^a-zA-Z0-9:;\],-]/g, 'X');
  }

  const calculateCRC32 = (data: Buffer): string => {
    // find index of 0x03
    const startByteIndex = data.indexOf('\x02') + 1;
    const endByteIndex = data.indexOf('\x03');
    // data with crc is between 0x02 and 0x03
    const dataWithCrC = data.slice(startByteIndex, endByteIndex);
    const dataBuffer = Buffer.from(dataWithCrC.slice(0, dataWithCrC.length - 8));

    console.log("data with crc", Buffer.from(dataWithCrC).toString('ascii'));
    console.log("data buffer", Buffer.from(dataBuffer).toString('ascii'));

    // const crc32 = CRC32.buf(dataBuffer) >>> 0;
    const crc32 = crc32Calc(dataBuffer) >>> 0;
    console.log("calculated crc32 int ", crc32);

    const crc32String = crc32.toString(16).toUpperCase();

    console.log(`Calculated CRC32: 0x${crc32String}`)
    return crc32String;
  }

  const prepareResponseBuffer = (data: string): Buffer => {
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
    const dateTimeString = "2015-7-21;9:34:11"
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
    const crcBegin = 1;
    const crcEnd = i;

    const crc32 = crc32Calc(responseBuffer.slice(crcBegin, crcEnd)) >>> 0;
    console.log("crc32: ", crc32.toString(16));

    // write crc as hex to buffer
    responseBuffer.write(crc32.toString(16).toUpperCase(), i, 8, 'ascii');
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

  const acknowledgeDataRead = async (device?: Device, data?: string) => {
    if (!device || !data) {
      return;
    }

    let responseBuffer = prepareResponseBuffer(data);
    await sleep(READ_WAIT_DELAY);

    // split data to 20 byte chunks
    const chunkSize = 20;
    const dataLength = responseBuffer.length;

    console.log("response data length", dataLength);

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
  }

  const parseCRC32FromData = (data: string): string => {
    // find index of 0x03
    const endByteIndex = data.indexOf('\x03');
    // CRC is last 8 chars
    return data.substring(endByteIndex - 8, endByteIndex);
  }


  const readDataFromBTR2 = async (device?: Device) => {
    if (!device) {
      return;
    }
    // read from handle 32 (read control point to get length)
    const readLenCharacteristics = await device.readCharacteristicForService(
      SERVICES.MOBA_BTR2.SERVICE_UUID,
      SERVICES.MOBA_BTR2.CHARACTERISTICS.READ_CONTROL_POINT_32,
    );
    consoleLogBlePlxObject(readLenCharacteristics, 'read control point');

    // get len from base64
    const len = Buffer.from(readLenCharacteristics.value || '', 'base64').readUInt8(0);
    const readPointer = Buffer.from(readLenCharacteristics.value || '', 'base64').readUInt8(1);
    let responseLen = readPointer;
    console.log('data len: ', len);
    console.log('read pointer: ', readPointer);

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

    console.log("data: ", dataString);
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

      console.log("respString: ", currentDataChunk);

      dataString = `${dataString}${currentDataChunk}`
      data = Buffer.concat([data, currentDataBuffer]);
      responseLen = data.length;
      console.log("responseLen: ", responseLen, 'len: ', len);
    }
    console.log("data: ", dataString);
    console.log("data: ", data);
    console.log("data hex", data.toString('hex'));

    const parsedCRC32 = parseCRC32FromData(dataString);
    console.log("parsedCRC32: ", parsedCRC32);
    const calculatedCRC32 = calculateCRC32(data);

    if (parsedCRC32 !== calculatedCRC32) {
      console.log("CRC32 does not match");
      return;
    } else {
      // acknowledge data read
      await acknowledgeDataRead(device, dataString);
    }


  }

  useInterval(() => {
    setScannerDevices(devices.current);
  }, 1000);


  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={{
          backgroundColor: 'red',
          padding: 20,
          borderRadius: 20,
        }}
        onPress={() => {
          if (scanningDevices) {
            stopDeviceScan();
          } else {
            startDeviceScan().then();
          }
        }}
      >
        <Text>
          {scanningDevices ? 'Stop Scanning' : 'Start Scanning'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={{
          backgroundColor: 'green',
          padding: 20,
          borderRadius: 20,
          marginVertical: 10,
        }}
        onPress={() => readDataFromBTR2(connectedDevice)}
      >
        <Text>Read data from btr2</Text>
      </TouchableOpacity>
      <ScrollView>
        {scannerDevices.map((device) => (
            <TouchableOpacity
              key={device.id}
              style={{
                marginHorizontal: 10,
                backgroundColor: 'blue',
                paddingHorizontal: 12,
                paddingVertical: 12,
                borderRadius: 5,
                marginTop: 10,
              }}
              onPress={() => {
                connectToDevice(device).then((d) => {
                  // console.log('connected to device', d);
                });
              }}
            >
              <Text>{device.id} {`\n`}{device.localName || "No device name"}</Text>
            </TouchableOpacity>
          )
        )}
      </ScrollView>
      {/*<Text style={styles.title}>Tab One</Text>*/}
      {/*<View style={styles.separator} lightColor="#eee" darkColor="rgba(255,255,255,0.1)"/>*/}
      {/*<EditScreenInfo path="app/(tabs)/index.tsx"/>*/}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: '80%',
  },
});
