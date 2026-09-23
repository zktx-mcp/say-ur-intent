import { describe, expect, it } from "vitest";
import {
  SUI_DEFI_ACTIVITY_CLASSIFIER_VERSION,
  classifySuiDeFiActivity
} from "../src/core/activity/transactionActivityClassifier.js";
import {
  compactExternalActivityTransactionDetails,
  type ExternalActivityTransactionDetail
} from "../src/core/activity/transactionActivityDetails.js";
import { SUI_DEFI_ACTIVITY_PROTOCOL_RULES } from "../src/core/activity/transactionActivityProtocolRules.js";
import { parseSuiAddress } from "../src/core/suiAddress.js";

const DEEPBOOK_PINNED_PACKAGE =
  "0xf48222c4e057fa468baf136bff8e12504209d43850c5778f76159292a96f621e";
const DEEPBOOK_DOCS_PACKAGE =
  "0x337f4f4f6567fcd778d5454f27c16c70e2f274cc6377ea6249ddf491482ef497";
const DEEPTRADE_PACKAGE =
  "0xc10d536b6580d809711b9bb8eee3945d5e96f92a346c84d74ff7a0697e664695";
const CETUS_PACKAGE =
  "0x25ebb9a7c50eb17b3fa9c5a30fb8b5ad8f97caaf4928943acbcff7153dfee5e3";
const CETUS_GLOBAL_CONFIG =
  "0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f";
const SUILEND_PACKAGE =
  "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf";
const SUILEND_MVR_CORE_PACKAGE =
  "0xe53906c2c058d1e369763114418f3c144d1b74960d29b2785718a782fec09b61";
const AFTERMATH_EVENTS_PACKAGE =
  "0x7f6ce7ade63857c4fd16ef7783fed2dfc4d7fb7e40615abdb653030b76aef0c6";
const AFTERMATH_AFSUI_PACKAGE =
  "0x1575034d2729907aefca1ac757d6ccfcd3fc7e9e77927523c06007d8353ad836";
const KNOWN_PROTOCOL_RULE_LIMITATIONS = new Set([
  "deepbook_package_conflict_open"
]);
const KNOWN_MATCH_LIMITATIONS = new Set([
  "deepbook_package_conflict_open",
  "event_details_truncated",
  "move_call_details_truncated",
  "no_direct_move_call_match",
  "not_position_inventory_or_pnl_or_signing",
  "object_change_details_truncated",
  "shared_object_match_does_not_prove_wallet_position",
  "transaction_activity_label_only"
]);

function detail(overrides: Partial<ExternalActivityTransactionDetail>): ExternalActivityTransactionDetail {
  return {
    transactionKind: "ProgrammableTransaction",
    moveCalls: [],
    balanceChanges: [],
    objectChanges: [],
    events: [],
    truncation: {
      moveCalls: false,
      balanceChanges: false,
      objectChanges: false,
      events: false
    },
    ...overrides
  };
}

function moveCall(
  packageId: string,
  module: string,
  functionName: string,
  commandIndex = 0
): ExternalActivityTransactionDetail["moveCalls"][number] {
  return {
    commandIndex,
    package: packageId,
    module,
    function: functionName,
    target: `${packageId}::${module}::${functionName}`
  };
}

describe("Sui DeFi activity classifier", () => {
  it("keeps protocol rule provenance structurally bounded", () => {
    const protocolIds = new Set<string>();

    for (const rule of SUI_DEFI_ACTIVITY_PROTOCOL_RULES) {
      expect(protocolIds.has(rule.protocolId)).toBe(false);
      protocolIds.add(rule.protocolId);
      expect(Object.keys(rule.packages).length).toBeGreaterThan(0);

      for (const [address, packageRule] of Object.entries(rule.packages)) {
        expect(parseSuiAddress(address)).toBe(address);
        expect(packageRule.source.trim().length).toBeGreaterThan(0);
        if (/mvr/i.test(packageRule.source)) {
          expect(packageRule.mvrName).toMatch(/^@[^/]+\/[^/]+$/);
        }
        if (packageRule.limitation !== undefined) {
          expect(KNOWN_PROTOCOL_RULE_LIMITATIONS.has(packageRule.limitation)).toBe(true);
        }
      }

      for (const [address, label] of Object.entries(rule.sharedObjects)) {
        expect(parseSuiAddress(address)).toBe(address);
        expect(label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps balance-only activity unclassified", () => {
    const matches = classifySuiDeFiActivity(detail({
      balanceChanges: [
        {
          index: 0,
          coinType: "0x2::sui::SUI",
          amountRaw: "-1000",
          direction: "decrease"
        }
      ]
    }));

    expect(matches).toEqual([]);
  });

  it("classifies DeepTrade wrapper activity as primary over DeepBook dependency evidence", () => {
    const matches = classifySuiDeFiActivity(detail({
      moveCalls: [
        moveCall(DEEPTRADE_PACKAGE, "dt_order", "create_limit_order", 0),
        moveCall(DEEPBOOK_PINNED_PACKAGE, "pool", "place_limit_order", 1)
      ]
    }));

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      classifierVersion: SUI_DEFI_ACTIVITY_CLASSIFIER_VERSION,
      protocolId: "deeptrade-core",
      primaryAction: "order",
      matchBasis: "direct_move_call",
      relatedProtocols: [
        {
          protocolId: "deepbook-v3",
          reason: "deeptrade_wrapper_touched_deepbook_evidence"
        }
      ]
    });
    expect(matches[0]?.evidence).toContainEqual(expect.objectContaining({
      kind: "moveCall",
      packageSource: "mvr_current_mainnet_resolution_and_deeptrade_research_snapshot",
      mvrName: "@deeptrade/deeptrade-core"
    }));
    expect(matches[0]?.limitations).toContain("transaction_activity_label_only");
  });

  it("marks the DeepBook docs package conflict when the research snapshot package matches", () => {
    const matches = classifySuiDeFiActivity(detail({
      moveCalls: [
        moveCall(DEEPBOOK_DOCS_PACKAGE, "pool", "swap_exact_base_for_quote")
      ]
    }));

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      protocolId: "deepbook-v3",
      primaryAction: "swap",
      matchBasis: "direct_move_call"
    });
    expect(matches[0]?.limitations).toContain("deepbook_package_conflict_open");
  });

  it("uses shared objects as shared_object evidence without inferring a position", () => {
    const matches = classifySuiDeFiActivity(detail({
      objectChanges: [
        {
          index: 0,
          objectId: CETUS_GLOBAL_CONFIG,
          changeKind: "mutated"
        }
      ]
    }));

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      protocolId: "cetus-clmm",
      matchBasis: "shared_object",
      primaryAction: "unknown",
      evidence: [
        {
          kind: "sharedObject",
          objectId: CETUS_GLOBAL_CONFIG,
          label: "cetus_global_config"
        }
      ]
    });
    expect(matches[0]?.limitations).toContain("shared_object_match_does_not_prove_wallet_position");
  });

  it("carries MVR evidence on event and object type package matches", () => {
    const matches = classifySuiDeFiActivity(detail({
      events: [
        {
          sequenceNumber: "0",
          package: CETUS_PACKAGE,
          eventType: `${CETUS_PACKAGE}::pool::SwapEvent`
        }
      ],
      objectChanges: [
        {
          index: 0,
          objectId: "0x1",
          changeKind: "mutated",
          outputType: `${CETUS_PACKAGE}::position::Position`
        }
      ]
    }));

    expect(matches[0]).toMatchObject({
      protocolId: "cetus-clmm",
      evidence: expect.arrayContaining([
        expect.objectContaining({
          kind: "eventType",
          packageSource: "mvr_current_mainnet_resolution_and_cetus_research_snapshot",
          mvrName: "@cetuspackages/clmm"
        }),
        expect.objectContaining({
          kind: "objectType",
          packageSource: "mvr_current_mainnet_resolution_and_cetus_research_snapshot",
          mvrName: "@cetuspackages/clmm"
        })
      ])
    });
  });

  it("deduplicates repeated structural evidence", () => {
    const matches = classifySuiDeFiActivity(detail({
      events: [
        {
          sequenceNumber: "0",
          package: CETUS_PACKAGE,
          eventType: `${CETUS_PACKAGE}::pool::SwapEvent`
        },
        {
          sequenceNumber: "0",
          package: CETUS_PACKAGE,
          eventType: `${CETUS_PACKAGE}::pool::SwapEvent`
        }
      ]
    }));

    expect(matches[0]?.evidence).toHaveLength(1);
    expect(matches[0]?.classifierVersion).toBe(SUI_DEFI_ACTIVITY_CLASSIFIER_VERSION);
  });

  it("classifies lending direct package calls by action assetGroup", () => {
    const mvrSuilendMatches = classifySuiDeFiActivity(detail({
      moveCalls: [moveCall(SUILEND_MVR_CORE_PACKAGE, "lending", "borrow")]
    }));
    expect(mvrSuilendMatches[0]).toMatchObject({
      protocolId: "suilend-lending",
      primaryAction: "lending",
      matchBasis: "direct_move_call",
      evidence: [
        expect.objectContaining({
          kind: "moveCall",
          packageSource: "mvr_current_mainnet_resolution",
          mvrName: "@suilend/core"
        })
      ]
    });
  });

  it("does not treat type-only package rules as direct move-call evidence", () => {
    expect(classifySuiDeFiActivity(detail({
      moveCalls: [moveCall(SUILEND_PACKAGE, "lending", "borrow")]
    }))).toEqual([]);

    expect(classifySuiDeFiActivity(detail({
      moveCalls: [moveCall(AFTERMATH_AFSUI_PACKAGE, "afsui", "unstake")]
    }))).toEqual([]);

    expect(classifySuiDeFiActivity(detail({
      moveCalls: [moveCall(AFTERMATH_EVENTS_PACKAGE, "afsui", "unstake")]
    }))).toEqual([]);

    const objectTypeMatches = classifySuiDeFiActivity(detail({
      objectChanges: [
        {
          index: 0,
          objectId: "0x2",
          changeKind: "mutated",
          outputType: `${SUILEND_PACKAGE}::lending_market::Market`
        }
      ]
    }));
    expect(objectTypeMatches[0]).toMatchObject({
      protocolId: "suilend-lending",
      matchBasis: "object_type",
      primaryAction: "unknown"
    });
  });

  it("keeps type-only package rules available for object type evidence", () => {
    const matches = classifySuiDeFiActivity(detail({
      events: [
        {
          sequenceNumber: "0",
          package: AFTERMATH_EVENTS_PACKAGE,
          eventType: `${AFTERMATH_EVENTS_PACKAGE}::afsui::StakeEvent`
        }
      ],
      objectChanges: [
        {
          index: 0,
          objectId: "0x3",
          changeKind: "mutated",
          outputType: `${AFTERMATH_AFSUI_PACKAGE}::afsui::AFSUI`
        }
      ]
    }));

    expect(matches[0]).toMatchObject({
      protocolId: "aftermath-afsui",
      matchBasis: "event_type",
      primaryAction: "unknown"
    });
    expect(matches[0]?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "eventType" }),
      expect.objectContaining({ kind: "objectType" })
    ]));
  });

  it("prefers admin/versioning over broad protocol action keywords", () => {
    expect(classifySuiDeFiActivity(detail({
      moveCalls: [moveCall(CETUS_PACKAGE, "global_config", "set_fee_rate")]
    }))[0]).toMatchObject({
      protocolId: "cetus-clmm",
      primaryAction: "admin_or_versioning"
    });

    expect(classifySuiDeFiActivity(detail({
      moveCalls: [moveCall(SUILEND_MVR_CORE_PACKAGE, "reserve_config", "update_risk_parameters")]
    }))[0]).toMatchObject({
      protocolId: "suilend-lending",
      primaryAction: "admin_or_versioning"
    });
  });

  it("prefers substantive user actions over helper or admin calls in the same protocol match", () => {
    expect(classifySuiDeFiActivity(detail({
      moveCalls: [
        moveCall(DEEPTRADE_PACKAGE, "fee", "settle_protocol_fee_and_record", 0),
        moveCall(DEEPTRADE_PACKAGE, "swap", "swap_exact_base_for_quote_input_fee", 1)
      ]
    }))[0]).toMatchObject({
      protocolId: "deeptrade-core",
      primaryAction: "swap"
    });

    expect(classifySuiDeFiActivity(detail({
      moveCalls: [
        moveCall(CETUS_PACKAGE, "global_config", "set_fee_rate", 0),
        moveCall(CETUS_PACKAGE, "pool", "swap", 1)
      ]
    }))[0]).toMatchObject({
      protocolId: "cetus-clmm",
      primaryAction: "swap"
    });
  });

  it("does not classify reset-style names as admin solely because they contain set_", () => {
    expect(classifySuiDeFiActivity(detail({
      moveCalls: [moveCall(CETUS_PACKAGE, "pool", "reset_position")]
    }))[0]).toMatchObject({
      protocolId: "cetus-clmm",
      primaryAction: "liquidity"
    });
  });

  it("adds protocol matches to compact facts only when evidence exists", () => {
    expect(compactExternalActivityTransactionDetails(detail({
      moveCalls: [moveCall(CETUS_PACKAGE, "pool", "swap")]
    }))).toMatchObject({
      protocolMatches: [
        {
          protocolId: "cetus-clmm",
          primaryAction: "swap"
        }
      ]
    });

    expect(compactExternalActivityTransactionDetails(detail({
      balanceChanges: [
        {
          index: 0,
          coinType: "0x2::sui::SUI",
          amountRaw: "1000",
          direction: "increase"
        }
      ]
    }))).not.toHaveProperty("protocolMatches");
  });

  it("aggregates repeated ownerless balance changes in compact facts", () => {
    const compact = compactExternalActivityTransactionDetails(detail({
      balanceChanges: [
        {
          index: 0,
          coinType: "0x3::coin::RWA",
          amountRaw: "1000",
          direction: "increase"
        },
        {
          index: 1,
          coinType: "0x3::coin::RWA",
          amountRaw: "1000",
          direction: "increase"
        },
        {
          index: 2,
          coinType: "0x3::coin::RWA",
          amountRaw: "1000",
          direction: "increase"
        },
        {
          index: 3,
          coinType: "0x2::sui::SUI",
          amountRaw: "-10",
          direction: "decrease"
        }
      ]
    }));

    expect(compact.factScope).toBe("transaction");
    expect(compact.requestedAccountScoped).toBe(false);
    expect(compact.balanceChanges).toEqual([
      {
        coinType: "0x3::coin::RWA",
        amountRaw: "1000",
        direction: "increase",
        count: 3
      },
      {
        coinType: "0x2::sui::SUI",
        amountRaw: "-10",
        direction: "decrease"
      }
    ]);
  });

  it("keeps produced match limitations in the transaction-label boundary set", () => {
    const detailCases = [
      detail({
        moveCalls: [
          moveCall(DEEPTRADE_PACKAGE, "dt_order", "create_limit_order", 0),
          moveCall(DEEPBOOK_PINNED_PACKAGE, "pool", "place_limit_order", 1)
        ]
      }),
      detail({
        moveCalls: [moveCall(DEEPBOOK_DOCS_PACKAGE, "pool", "swap_exact_base_for_quote")]
      }),
      detail({
        objectChanges: [
          {
            index: 0,
            objectId: CETUS_GLOBAL_CONFIG,
            changeKind: "mutated"
          }
        ],
        truncation: {
          moveCalls: true,
          balanceChanges: false,
          objectChanges: true,
          events: true
        }
      }),
      detail({
        events: [
          {
            sequenceNumber: "0",
            package: CETUS_PACKAGE,
            eventType: `${CETUS_PACKAGE}::pool::SwapEvent`
          }
        ],
        objectChanges: [
          {
            index: 0,
            objectId: "0x1",
            changeKind: "mutated",
            outputType: `${CETUS_PACKAGE}::position::Position`
          }
        ]
      }),
      detail({
        moveCalls: [moveCall(SUILEND_MVR_CORE_PACKAGE, "lending", "borrow")]
      }),
      detail({
        events: [
          {
            sequenceNumber: "0",
            package: AFTERMATH_EVENTS_PACKAGE,
            eventType: `${AFTERMATH_EVENTS_PACKAGE}::afsui::StakeEvent`
          }
        ],
        objectChanges: [
          {
            index: 0,
            objectId: "0x3",
            changeKind: "mutated",
            outputType: `${AFTERMATH_AFSUI_PACKAGE}::afsui::AFSUI`
          }
        ]
      })
    ];

    for (const match of detailCases.flatMap((item) => classifySuiDeFiActivity(item))) {
      expect(match.limitations).toContain("transaction_activity_label_only");
      expect(match.limitations).toContain("not_position_inventory_or_pnl_or_signing");
      for (const limitation of match.limitations) {
        expect(KNOWN_MATCH_LIMITATIONS.has(limitation)).toBe(true);
      }
    }
  });
});
