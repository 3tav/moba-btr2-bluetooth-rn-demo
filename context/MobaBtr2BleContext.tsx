/* eslint-disable no-bitwise */
import React, {createContext, useEffect, useRef, useState,} from 'react';
import {BleManager, Device,} from 'react-native-ble-plx';
import {enableBluetooth} from "../helpers/BlePlxHelpers";
import {connectToBtr2Device, readDataFromBTR2} from "../helpers/Btr2CommunicationHelpers";
import {sleep} from "../helpers/sleep";
import {READ_WAIT_DELAY} from "../constants/Btr2Constants";
import {getChipNumberFromDataString} from "../helpers/Btr2DataHelpers";
import useInterval from "../helpers/useInterval";

type BleState =
  | 'BLE_DISABLED'
  | 'BLE_ENABLED'
  | 'SCANNING_DEVICES'
  | 'DEVICE_FOUND'
  | 'CONNECTING_TO_DEVICE'
  | 'CONNECTED_TO_DEVICE'
  | 'TRANSMITTING_DATA'
  | 'DEVICE_DISCONNECTED';

export type MobaBtr2BleProviderProps = {
  startDeviceScanAction: () => void;
  stopDeviceScanAction: () => void;
  lastScannedData?: string;
  isBleEnabled?: boolean;
};

const contextDefaultValues: MobaBtr2BleProviderProps = {
  startDeviceScanAction: () => null,
  stopDeviceScanAction: () => null,
  lastScannedData: undefined,
  isBleEnabled: false,
};

export const MobaBtr2BleContext = createContext<MobaBtr2BleProviderProps>(contextDefaultValues);


export interface MobaBtr2BleProps {
  children: React.ReactNode;
}

const MobaBtr2BleProvider: React.FC<MobaBtr2BleProps> = ({children}) => {
  const bleManager = useRef<BleManager>();
  const foundDevicesRef = useRef<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device>();
  const [scannedData, setScannedData] = useState<string[]>([]);
  const [bleState, setBleState] = useState<BleState>('BLE_DISABLED');
  const bleStateRef = useRef(bleState);

  const setState = (newBleState: BleState) => {
    // set the ref and bleState to the new state
    bleStateRef.current = newBleState;
    setBleState(newBleState);
  }

  // // print the state every 2 seconds - for debugging
  // useInterval(() => {
  //   console.log(`current State: ${bleStateRef.current} and bleState: ${bleState}`)
  // }, 2000)

  useEffect(() => {
    switch (bleState) {
      case 'BLE_DISABLED':
        console.log('Bluetooth is disabled');
        stopDeviceScan();
        foundDevicesRef.current = [];
        setScannedData([]);
        if (connectedDevice) {
          disconnectFromDevice(connectedDevice).then();
        }
        break;
      case 'BLE_ENABLED':
        startDeviceScan().then();
        break;
      case 'SCANNING_DEVICES':
        console.log('Scanning devices state');
        break;
      case 'DEVICE_FOUND':
        if (foundDevicesRef.current.length > 0) {
          stopDeviceScan();
          connectToDevice(foundDevicesRef.current[0]).then();
        } else {
          setState('BLE_ENABLED');
        }
        break;
      case 'CONNECTING_TO_DEVICE':
        console.log('Connecting to device')
        break;
      case 'CONNECTED_TO_DEVICE':
        setState('TRANSMITTING_DATA');
        continuousDataRead(connectedDevice).then()
        break;
      case 'TRANSMITTING_DATA':
        console.log('Transmitting data')
        break;
      case 'DEVICE_DISCONNECTED':
        disconnectFromDevice(connectedDevice).then();
        foundDevicesRef.current = [];
        setState('BLE_ENABLED'); // Go back to initial state
        break;
      default:
        console.warn('Unknown state:', bleState);
        break;
    }
  }, [bleState]);

  useEffect(() => {
    bleManager.current = new BleManager();
  }, []);


  const addDevice = (device: Device) => {
    if (
      device.name?.includes("MOBA")
      && bleStateRef.current === 'SCANNING_DEVICES' // stateRef is used to prevent stale state
    ) {
      console.log('Found device: ', device.name, device.serviceUUIDs);
      if (foundDevicesRef.current.find((x) => x.id === device.id)) {
        console.log('Already found this device');
        return;
      } else {
        foundDevicesRef.current = [...foundDevicesRef.current, device];
        setState('DEVICE_FOUND')
      }
    }
  };

  const startDeviceScan = async () => {
    stopDeviceScan();
    setState('SCANNING_DEVICES')
    foundDevicesRef.current = [];
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
  };

  const connectToDevice = async (device: Device): Promise<void> => {
    setState('CONNECTING_TO_DEVICE')
    try {
      const btr2ConnectedDevice = await connectToBtr2Device(device);
      setConnectedDevice(btr2ConnectedDevice);
      await sleep(READ_WAIT_DELAY);
      setState('CONNECTED_TO_DEVICE')
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

  const continuousDataRead = async (device?: Device): Promise<void> => {

    let isReading = true; // Use this to determine if you should continue reading

    const recursiveRead = async () => {
      try {
        const dataString = await readDataFromBTR2(device);
        console.log(`Read data from device: ${dataString}`);

        const chipNumber = getChipNumberFromDataString(dataString);
        setScannedData((prev) => [...prev, chipNumber]);
      } catch (e: any) {
        console.log("error reading data from device", e);
        // if e is of type "device disconnected" then stop the interval
        if (e?.message?.includes("is not connected")) {
          isReading = false; // Stop further readings
        }
      } finally {
        if (bleStateRef.current === 'BLE_DISABLED'){
          console.log('BLE is disabled, stopping recursive read');
        }
        else if (isReading) { // Only reschedule if isReading is still true
          setTimeout(recursiveRead, READ_WAIT_DELAY);
        } else {
          disconnectFromDevice(device).then(() => {
            setState('DEVICE_DISCONNECTED')
          });
        }
      }
    };
    recursiveRead().then(); // Kickstart the recursive reading
  };

  const startDeviceScanAction = () => {
    setState('BLE_ENABLED');
  }

  const stopDeviceScanAction = () => {
    setState('BLE_DISABLED');
  }

  const lastScannedData = React.useMemo(() => {
    if (scannedData.length === 0) {
      return undefined;
    }
    return scannedData[scannedData.length - 1];
  }, [scannedData]);

  const isBleEnabled = React.useMemo(() => {
    return bleState !== 'BLE_DISABLED';
  }, [bleState]);

  const value = React.useMemo(
    () => ({
      startDeviceScanAction,
      stopDeviceScanAction,
      lastScannedData,
      isBleEnabled: isBleEnabled,
    }),
    [startDeviceScanAction, stopDeviceScanAction, lastScannedData, isBleEnabled],
  );
  return (
    <MobaBtr2BleContext.Provider value={value}>
      {children}
    </MobaBtr2BleContext.Provider>
  );
};

export default MobaBtr2BleProvider;
