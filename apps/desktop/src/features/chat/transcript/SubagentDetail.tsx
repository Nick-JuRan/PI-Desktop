import { useId } from "react";
import { useTranslation } from "react-i18next";
import { IconTarget } from "../../../components/icons";
import {
  nestedDelegationItems,
  summarizeSubagentActivity,
  type DelegationActivityItem,
  type SubagentOutcome,
  type SubagentTiming,
} from "../../../lib/subagent-topology";
import { ToolRow } from "./ToolRow";

function SubagentTopologyNode({
  item,
  delegationStatuses,
  delegationTimings,
  onUserInteraction,
}: {
  item: DelegationActivityItem;
  delegationStatuses?: ReadonlyMap<string, SubagentOutcome>;
  delegationTimings?: ReadonlyMap<string, SubagentTiming>;
  onUserInteraction?: () => void;
}) {
  const children = nestedDelegationItems(item.delegate);
  return (
    <div className="subagent-topology-branch" role="listitem">
      <ToolRow
        message={item.message}
        {...(item.delegate ? { delegate: item.delegate } : {})}
        variant="topology"
        onUserInteraction={onUserInteraction}
        {...(delegationStatuses ? { delegationStatuses } : {})}
        {...(delegationTimings ? { delegationTimings } : {})}
      />
      {children.length > 0 ? (
        <div className="subagent-topology-children" role="list">
          {children.map((child) => (
            <SubagentTopologyNode
              key={child.message.id}
              item={child}
              delegationStatuses={delegationStatuses}
              delegationTimings={delegationTimings}
              onUserInteraction={onUserInteraction}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A truthful recursive delegation graph (ADR 0062).
 *
 * Each Task card owns the rows emitted by its delegate. Nested Task calls are
 * rendered as connected child branches using the same accessible tab behavior.
 */
export function SubagentTopology({
  items,
  delegationStatuses,
  delegationTimings,
  onUserInteraction,
}: {
  items: DelegationActivityItem[];
  delegationStatuses?: ReadonlyMap<string, SubagentOutcome>;
  delegationTimings?: ReadonlyMap<string, SubagentTiming>;
  onUserInteraction?: () => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const summary = summarizeSubagentActivity(items, delegationStatuses);

  return (
    <section className="subagent-topology" aria-labelledby={labelId}>
      <div className="subagent-topology-root">
        <span className="subagent-topology-root-icon" aria-hidden>
          <IconTarget size={16} />
        </span>
        <span className="subagent-topology-root-copy">
          <strong id={labelId}>{t("chat.subagentCoordinator")}</strong>
          <span>
            {t("chat.subagentCoordinating", { count: summary.total })}
          </span>
        </span>
      </div>
      <span className="subagent-topology-connector" aria-hidden />
      <div
        className="subagent-topology-agents"
        role="list"
        aria-label={t("chat.subagentTopology")}
      >
        {items.map((item) => (
          <SubagentTopologyNode
            key={item.message.id}
            item={item}
            delegationStatuses={delegationStatuses}
            delegationTimings={delegationTimings}
            onUserInteraction={onUserInteraction}
          />
        ))}
      </div>
    </section>
  );
}
