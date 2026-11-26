// Authentication and protocol readiness only; no messages, contacts or media.
const allowed={
  'wawc':['user','ps_meta','ps_tokens'],
  'signal-storage':null,
  'wawc_db_enc':null,
  'model-storage':['account-linking','acs-tokens','device-list','direct-connection-keys','sync-keys','coexv2-bot-secret','user-prefs'],
  'worker-storage':['local_storage']
};
const filters={
  'model-storage/user-prefs':[
    'WAADVSecretKey','WARoutingInfo','WAMdPairingTimestamp','WALoginCounter','WAMobilePlatform',
    'WAPrimaryCurrentVersion','WAPrimaryDeviceSupportsSyncdRecovery','WAPrimaryFeatures','WAVersionBase',
    'WAWebCompanionMetaNonce','WAWebEncryptedRid','WAIsAccountLidFieldMigrated','WAHaveProcessedCoexAdv',
    'WACriticalDataSynced','WANonCriticalDataSyncStatus',
    // A linked device must retain its completed bootstrap state. Removing it makes
    // WhatsApp wait for an initial history transfer that the phone already sent.
    'WAInitialHistorySynced','WAHistorySyncStatus','WAHistorySyncSingleChunkStatus',
    'WAMdHistoryLastChunkProcessed','WAMdHistoryLastRecentSyncChunkProcessed'
  ]
};
module.exports={allowed,filters};
