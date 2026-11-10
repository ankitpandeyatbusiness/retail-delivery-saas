// Web stand-in for react-native-blob-util (saves files into Android media storage)
const fail = async () => { throw new Error('Not available on the website'); };
const ReactNativeBlobUtil = {
    fs: { dirs: {}, exists: async () => false, writeFile: async () => {}, unlink: async () => {} },
    MediaCollection: { copyToMediaStore: fail },
    config: () => ({ fetch: fail }),
};
export default ReactNativeBlobUtil;
