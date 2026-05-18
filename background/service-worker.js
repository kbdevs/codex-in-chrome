import { NativeHostController } from "./service-worker-native-host.js";
import { BridgeController } from "./service-worker-bridge.js";
import { initializeServiceWorkerControlPlane } from "./service-worker-control-plane.js";

const nativeHostController = new NativeHostController();
const bridgeController = new BridgeController();

initializeServiceWorkerControlPlane(nativeHostController, bridgeController);
