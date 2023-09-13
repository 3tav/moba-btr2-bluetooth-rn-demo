import {BleManager, Characteristic, Device, Service} from "react-native-ble-plx";
import {Alert, Linking, Permission, PermissionsAndroid, Platform} from "react-native";
import * as Location from "expo-location";
import * as ExpoDevice from "expo-device";
import {BleCharacteristic} from "../constants/Btr2Constants";

export const consoleLogBlePlxObject = (bleObject: Service | Characteristic | Device, tag?: string) => {
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const {_manager, ...x} = bleObject;
  if (tag) console.log(`${tag}:`);
  console.log(x);
};

export const bluetoothLocationPermissionAndroid = async (): Promise<void> => new Promise<void>(async (resolve) => {
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

export const showBluetoothDisabledAlert = () => {
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

export const enableBluetooth = async (bleManager?: BleManager) => {
  if (!bleManager) {
    console.log('bleManager not set');
    return;
  }
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
  return new Promise<boolean>((resolve, reject) => {
    bleManager.state().then(async (state) => {
      if (state === 'PoweredOn') {
        resolve(true);
      } else {
        if (Platform.OS === 'ios') {
          showBluetoothDisabledAlert();
        } else {
          await bleManager.enable();
        }
        const subscription = bleManager.onStateChange((subscriptionState) => {
          if (subscriptionState === 'PoweredOn') {
            console.log('Bluetooth is powered on');
            subscription?.remove();
            resolve(true);
          }
        }, true);
      }
    });
  });
};

export const discoverServicesAndCharacteristics = async (device: Device): Promise<BleCharacteristic[]> => {
  const deviceWithServices = await device.discoverAllServicesAndCharacteristics();
  const services = await deviceWithServices.services();

  const discoveredCharacteristics: BleCharacteristic[] = [];

  const discoverCharacteristicsForService = async (service: Service) => {
    const characteristics = await service.characteristics();
    characteristics.forEach((characteristic: Characteristic) => {
      discoveredCharacteristics.push({
        serviceUUID: service.uuid,
        characteristicUUID: characteristic.uuid,
      });
      console.log(`service: ${service.uuid}, characteristic: ${characteristic.uuid}`);
    });
  };

  // Await all the service characteristic discovery operations to complete.
  await Promise.all(services.map(service => discoverCharacteristicsForService(service)));
  return discoveredCharacteristics;
};
