import { toast, UNSAVED_CHANGES_TOAST } from '@/components/ui/use-toast';
import {
  AddActionRequest,
  FlowOperationType,
  StepLocationRelativeToParent,
  flowStructureUtil,
} from '@activepieces/shared';

import { BuilderState } from '../../builder-hooks';
import { EMPTY_STEP_PARENT_NAME } from '../utils/consts';
import { ApButtonData } from '../utils/types';

export const getOperationsInClipboard = async () => {
  try {
    return JSON.parse(
      await navigator.clipboard.readText(),
    ) as AddActionRequest[];
  } catch (error) {
    return [];
  }
};

const clearSampleDataInfo = (
  settings: AddActionRequest['action']['settings'],
) => {
  const newSettings = JSON.parse(
    JSON.stringify(settings),
  ) as AddActionRequest['action']['settings'];
  delete newSettings.inputUiInfo?.sampleDataFileId;
  delete newSettings.inputUiInfo?.lastTestDate;
  return newSettings;
};

const replaceOldStepNamesAndMarkMissingSteps = (
  actionSettings: string,
  newStepsNamesMap: Record<string, string>,
): string => {
  const regex = new RegExp(
    `({{\\s*)step_(\\d+)(\\s*(?:[.\\[].*?)?\\s*}})`,
    'g',
  );
  const allStepsInSettings = [...actionSettings.matchAll(regex)];
  return allStepsInSettings.reduce((acc, regexMatch) => {
    const stepName = `step_${regexMatch[2]}`;
    const stepNameRegex = new RegExp(
      `({{\\s*)${stepName}(\\s*(?:[.\\[].*?)?\\s*}})`,
      'g',
    );
    if (newStepsNamesMap[stepName]) {
      return acc.replaceAll(stepNameRegex, `$1${newStepsNamesMap[stepName]}$2`);
    }
    return acc;
  }, actionSettings);
};

const modifyAddRequestsActionsNames = (
  operations: AddActionRequest[],
  flowVersion: BuilderState['flowVersion'],
) => {
  const allSteps = flowStructureUtil.getAllSteps(flowVersion.trigger);
  const allStepsNames = allSteps.map((step) => step.name);
  const newStepsNamesMap = operations.reduce((acc, operation) => {
    const unusedName = flowStructureUtil.findUnusedName(allStepsNames);
    allStepsNames.push(unusedName);
    acc[operation.action.name] = unusedName;
    return acc;
  }, {} as Record<string, string>);
  const allStepsDisplayNames = [...allSteps.map((step) => step.displayName)];

  return operations.map((operation) => {
    const actionSettings = clearSampleDataInfo(operation.action.settings);
    const settingsWithNewStepNames = replaceOldStepNamesAndMarkMissingSteps(
      JSON.stringify(actionSettings),
      newStepsNamesMap,
    );
    const displayName =
      allStepsDisplayNames.findIndex(
        (displayName) => displayName === operation.action.displayName,
      ) > -1
        ? `${operation.action.displayName} Copy`
        : operation.action.displayName;
    allStepsDisplayNames.push(displayName);
    return {
      ...operation,
      action: {
        ...operation.action,
        name: newStepsNamesMap[operation.action.name],
        settings: JSON.parse(settingsWithNewStepNames),
        displayName,
      },
      parentStep:
        newStepsNamesMap[operation.parentStep] || EMPTY_STEP_PARENT_NAME,
    };
  }) as AddActionRequest[];
};

export const pasteNodes = (
  operations: AddActionRequest[],
  flowVersion: BuilderState['flowVersion'],
  pastingDetails: {
    parentStepName: string;
    stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER | StepLocationRelativeToParent.INSIDE_LOOP;
  } | {
    branchIndex: number;
    stepLocationRelativeToParent: StepLocationRelativeToParent.INSIDE_BRANCH;
    parentStepName: string;
  },
  applyOperation: BuilderState['applyOperation'],
) => {
  const operationsToAddNewSteps = modifyAddRequestsActionsNames(
    operations,
    flowVersion,
  );
  const firstOperationWithoutParentStep = operationsToAddNewSteps.find(
    (operation) => operation.parentStep === EMPTY_STEP_PARENT_NAME,
  )!;
  firstOperationWithoutParentStep.parentStep = pastingDetails.parentStepName;
  firstOperationWithoutParentStep.branchIndex =
  pastingDetails.stepLocationRelativeToParent ===
    StepLocationRelativeToParent.INSIDE_BRANCH
      ? pastingDetails.branchIndex
      : undefined;
  firstOperationWithoutParentStep.stepLocationRelativeToParent =
  pastingDetails.stepLocationRelativeToParent;
  operationsToAddNewSteps
    .map((request) => {
      if (request.parentStep !== EMPTY_STEP_PARENT_NAME) {
        return request;
      }
      return {
        ...request,
        parentStep: firstOperationWithoutParentStep.action.name,
        branchIndex: undefined,
        stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
      };
    })
    .forEach((request) => {
      applyOperation(
        {
          type: FlowOperationType.ADD_ACTION,
          request,
        },
        () => {
          toast(UNSAVED_CHANGES_TOAST);
        },
      );
    });
};
