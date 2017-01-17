import IProjectionEngine from "./IProjectionEngine";
import IPushNotifier from "../push/IPushNotifier";
import {injectable, inject} from "inversify";
import IProjectionRegistry from "../registry/IProjectionRegistry";
import * as _ from "lodash";
import AreaRegistry from "../registry/AreaRegistry";
import PushContext from "../push/PushContext";
import IStatePublisher from "../routing/IStatePublisher";
import {ISnapshotRepository, Snapshot} from "../snapshots/ISnapshotRepository";
import RegistryEntry from "../registry/RegistryEntry";
import IProjectionRunnerFactory from "./IProjectionRunnerFactory";
import ILogger from "../log/ILogger";
import NullLogger from "../log/NullLogger";
import IProjectionSorter from "./IProjectionSorter";
import {IProjection} from "./IProjection";

@injectable()
class ProjectionEngine implements IProjectionEngine {

    constructor(@inject("IProjectionRunnerFactory") private runnerFactory: IProjectionRunnerFactory,
                @inject("IPushNotifier") private pushNotifier: IPushNotifier,
                @inject("IProjectionRegistry") private registry: IProjectionRegistry,
                @inject("IStatePublisher") private statePublisher: IStatePublisher,
                @inject("ISnapshotRepository") private snapshotRepository: ISnapshotRepository,
                @inject("ILogger") private logger: ILogger = NullLogger,
                @inject("IProjectionSorter") private sorter: IProjectionSorter) {
    }

    run(projection?: IProjection<any>, context?: PushContext, snapshot?: Snapshot<any>) {
        if (!projection) {
            this.sorter.sort();
            this.snapshotRepository.initialize().subscribe(() => this.restart(projection));
        } else {
            this.runSingleProjection(projection, context, snapshot);
        }
    }

    private runSingleProjection(projection: IProjection<any>, context: PushContext, snapshot?: Snapshot<any>) {
        let runner = this.runnerFactory.create(projection);

        let sequence = runner
            .notifications()
            .do(state => {
                let snapshotStrategy = projection.snapshotStrategy;
                if (state.timestamp && snapshotStrategy && snapshotStrategy.needsSnapshot(state)) {
                    this.snapshotRepository.saveSnapshot(state.type, new Snapshot(runner.state, state.timestamp));
                    this.logger.info(`Saving snapshot for ${state.type} at time ${state.timestamp.toISOString()}`);
                }
            })
            .sample(200);

        let subscription = sequence.subscribe(state => {
            this.pushNotifier.notify(context, null, state.splitKey);
            this.logger.info(`Notifying state change on ${context.area}:${context.viewmodelId} with key ${state.splitKey}`);
        }, error => {
            this.logger.error(error);
            this.logger.info(`Restarting projection due to error ${projection.name}`);
            this.restart(projection, context);
        });

        sequence.finally(() => {
            console.log('finally');
            subscription.dispose()
        });

        this.statePublisher.publish(runner, context);
        runner.run(snapshot);
    }

    restart(projection?: IProjection<any>, context?: PushContext, snapshot?: Snapshot<any>) {
        this.snapshotRepository.getSnapshots().subscribe(snapshots => {
            let areas = this.registry.getAreas();
            _.forEach<AreaRegistry>(areas, areaRegistry => {
                _.forEach<RegistryEntry<any>>(areaRegistry.entries, (entry: RegistryEntry<any>) => {
                    let projection = entry.projection;
                    this.runSingleProjection(projection, new PushContext(entry.name, areaRegistry.area), snapshots[projection.name]);
                });
            });
        });
    }
}

export default ProjectionEngine