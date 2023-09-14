import {StyleSheet, TouchableOpacity} from 'react-native';
import {Text, View} from '../../components/Themed';
import {useContext} from "react";
import {MobaBtr2BleContext} from "../../context/MobaBtr2BleContext";


export default function TabOneScreen() {
  const {
    isBleEnabled,
    startDeviceScanAction,
    stopDeviceScanAction,
    lastScannedData
  } = useContext(MobaBtr2BleContext);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={{
          backgroundColor: 'red',
          padding: 20,
          borderRadius: 20,
        }}
        onPress={() => {
          if (isBleEnabled) {
            stopDeviceScanAction();
          } else {
            startDeviceScanAction();
          }
        }}
      >
        <Text>
          {isBleEnabled ? 'Stop data transmission' : 'Enable data transmission'}
        </Text>
      </TouchableOpacity>
      <Text
        style={{
          marginHorizontal: 10,
          marginVertical: 20,
          fontSize: 30,
        }}
      >
        {lastScannedData}
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
