import {ScrollView, StyleSheet, TouchableOpacity} from 'react-native';
import {Text, View} from '../../components/Themed';

import {BleManager, Device,} from 'react-native-ble-plx';
import {useEffect, useRef, useState} from "react";
import useInterval from "../../helpers/useInterval";
import {enableBluetooth} from "../../helpers/BlePlxHelpers";
import {connectToBtr2Device, readDataFromBTR2} from "../../helpers/Btr2CommunicationHelpers";
import {getChipNumberFromDataString} from "../../helpers/Btr2DataHelpers";
import {READ_WAIT_DELAY} from "../../constants/Btr2Constants";
import {sleep} from "../../helpers/sleep";


export default function TabOneScreen() {
  const bleManager = useRef<BleManager>();
  const devices = useRef<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device>();
  const [scanningDevices, setScanningDevices] = useState(false);
  const [detectedBtr2Devices, setDetectedBtr2Devices] = useState<Device[]>([]);

  const [scannedData, setScannedData] = useState<string[]>([]);

  useEffect(() => {
    bleManager.current = new BleManager();
  }, []);


  useInterval(() => {
    setDetectedBtr2Devices(devices.current);
  }, 1000);


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
    console.log('Initializing BLE plx');
    const isBluetoothEnabled = await enableBluetooth(bleManager.current);
    console.log('Bluetooth is enabled, scanning devices');
    if (isBluetoothEnabled) {
      bleManager.current?.startDeviceScan(null, {
        allowDuplicates: true,
      }, (error, device) => {
        if (error) {
          console.error(error)
        } else if (device) {
          addDevice(device);
        }
      });
    } else {
      console.log('Bluetooth is not enabled');
    }
  };

  const stopDeviceScan = () => {
    bleManager.current?.stopDeviceScan();
    setScanningDevices(false);
  };

  const connectToDevice = async (device: Device): Promise<void> => {
    try {
      const btr2ConnectedDevice = await connectToBtr2Device(device);
      setConnectedDevice(btr2ConnectedDevice);
      await sleep(READ_WAIT_DELAY);
      continuousReadData(btr2ConnectedDevice).then()
    } catch (e) {
      console.log("error connecting to device", e);
    }
  };

  const disconnectFromDevice = async (device?: Device): Promise<void> => {
    if (!device) {
      setConnectedDevice(undefined);
      return;
    }
    try {
      await device.cancelConnection();
    } catch (e) {
      console.log("error disconnecting from device", e);
    } finally {
      setConnectedDevice(undefined);
    }
  }

  const readData = async (device?: Device): Promise<void> => {
    try {
      const dataString = await readDataFromBTR2(device);
      const chipNumber = getChipNumberFromDataString(dataString);
      setScannedData((prev) => [...prev, chipNumber]);
      console.log(`Read data from device: ${dataString}`);
    } catch (e: any) {
      console.log("error reading data from device", e);
      console.log("error message", e?.message);
      throw e;
    }
  }

  const continuousReadData = async (device?: Device): Promise<void> => {
    let isReading = true; // Use this to determine if you should continue reading

    const recursiveRead = async () => {
      try {
        const dataString = await readDataFromBTR2(device);
        const chipNumber = getChipNumberFromDataString(dataString);
        setScannedData((prev) => [...prev, chipNumber]);
        console.log(`Read data from device: ${dataString}`);


      } catch (e: any) {
        console.log("error reading data from device", e);
        // if e is of type "device disconnected" then stop the interval
        if (e?.message?.includes("is not connected")) {
          isReading = false; // Stop further readings
        }
      } finally {
        if (isReading) { // Only reschedule if isReading is still true
          setTimeout(recursiveRead, READ_WAIT_DELAY);
        } else {
          disconnectFromDevice(device).then();
        }
      }
    };

    recursiveRead().then(); // Kickstart the recursive reading
  };

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
        onPress={() => continuousReadData(connectedDevice)}
      >
        <Text>Read data from btr2</Text>
      </TouchableOpacity>
      <ScrollView>
        {detectedBtr2Devices.map((device) => (
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
      <Text
        style={{
          marginHorizontal: 10,
          marginVertical: 20,
          // color: '#555',
          fontSize: 30,
        }}
      >
        {scannedData[scannedData.length - 1]}
      </Text>
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
