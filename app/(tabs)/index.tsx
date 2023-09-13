import {ScrollView, StyleSheet, TouchableOpacity} from 'react-native';
import {Text, View} from '../../components/Themed';

import {BleManager, Device,} from 'react-native-ble-plx';
import {useEffect, useRef, useState} from "react";
import useInterval from "../../helpers/useInterval";
import {enableBluetooth} from "../../helpers/BlePlxHelpers";
import {connectToBtr2Device, readDataFromBTR2} from "../../helpers/Btr2CommunicationHelpers";


export default function TabOneScreen() {
  const bleManager = useRef<BleManager>();
  const devices = useRef<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device>();
  const [scanningDevices, setScanningDevices] = useState(false);
  const [scannedBtr2Devices, setScannedBtr2Devices] = useState<Device[]>([]);

  useEffect(() => {
    bleManager.current = new BleManager();
  }, []);


  useInterval(() => {
    setScannedBtr2Devices(devices.current);
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
    } catch (e) {
      console.log("error connecting to device", e);
    }
  };

  const readData = async (device?: Device): Promise<void> => {
    try {
      const dataString = await readDataFromBTR2(device);
      console.log(`Read data from device: ${dataString}`);
    } catch (e) {
      console.log("error reading data from device", e);
    }
  }

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
        onPress={() => readData(connectedDevice)}
      >
        <Text>Read data from btr2</Text>
      </TouchableOpacity>
      <ScrollView>
        {scannedBtr2Devices.map((device) => (
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
