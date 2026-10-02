import { createWalletConnectTransport } from "./walletConnectTransport.js";
import { runWalletSdkChild } from "./walletSdkChildRuntime.js";

runWalletSdkChild(({ projectId, dataDirectory, metadata }) => createWalletConnectTransport({ projectId, dataDirectory, metadata }));
