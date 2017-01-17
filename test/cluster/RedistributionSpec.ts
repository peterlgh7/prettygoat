import "reflect-metadata";
import expect = require("expect.js");
import IProjectionEngine from "../../scripts/projections/IProjectionEngine";
import {IProjection} from "../../scripts/projections/IProjection";
import {Subject, Observable} from "rx";
import RegistryEntry from "../../scripts/registry/RegistryEntry";
import {ISnapshotRepository, Snapshot} from "../../scripts/snapshots/ISnapshotRepository";
import IProjectionRegistry from "../../scripts/registry/IProjectionRegistry";
import AreaRegistry from "../../scripts/registry/AreaRegistry";
import MockSnapshotRepository from "../fixtures/MockSnapshotRepository";
import MockProjectionRegistry from "../fixtures/MockProjectionRegistry";
import * as TypeMoq from "typemoq";
import DynamicNameProjection from "../fixtures/definitions/DynamicNameProjection";
import ICluster from "../../scripts/cluster/ICluster";
import MockCluster from "../fixtures/cluster/MockCluster";
import ClusteredProjectionEngine from "../../scripts/cluster/ClusteredProjectionEngine";
import {Scheduler} from "rx";
import Dictionary from "../../scripts/Dictionary";
import MockProjectionEngine from "../fixtures/MockProjectionEngine";
import IProjectionRunner from "../../scripts/projections/IProjectionRunner";
import MockProjectionRunner from "../fixtures/MockProjectionRunner";
import {ProjectionRunnerStatus} from "../../scripts/projections/ProjectionRunnerStatus";

describe("Given a set of projections to redistribute", () => {
    let subject: IProjectionEngine,
        registry: TypeMoq.Mock<IProjectionRegistry>,
        snapshotRepository: TypeMoq.Mock<ISnapshotRepository>,
        projection1: IProjection<any>,
        projection2: IProjection<any>,
        runner1: TypeMoq.Mock<IProjectionRunner<any>>,
        runner2: TypeMoq.Mock<IProjectionRunner<any>>,
        cluster: TypeMoq.Mock<ICluster>,
        engine: TypeMoq.Mock<IProjectionEngine>,
        holder: Dictionary<IProjectionRunner<any>>;

    beforeEach(() => {
        projection1 = new DynamicNameProjection("projection1").define();
        projection2 = new DynamicNameProjection("projection2").define();
        runner1 = TypeMoq.Mock.ofType(MockProjectionRunner);
        runner2 = TypeMoq.Mock.ofType(MockProjectionRunner);
        holder = {
            projection1: runner1.object,
            projection2: runner2.object
        };
        registry = TypeMoq.Mock.ofType(MockProjectionRegistry);
        registry.setup(r => r.getAreas()).returns(a => {
            return [
                new AreaRegistry("Admin", [
                    new RegistryEntry(projection1, "projection1"),
                    new RegistryEntry(projection2, "projection2")
                ])
            ]
        });
        snapshotRepository = TypeMoq.Mock.ofType(MockSnapshotRepository);
        snapshotRepository.setup(s => s.saveSnapshot("test", TypeMoq.It.isValue(new Snapshot(66, new Date(5000))))).returns(a => null);
        snapshotRepository.setup(s => s.initialize()).returns(a => Observable.just(null));
        snapshotRepository.setup(s => s.getSnapshots()).returns(a => Observable.just<Dictionary<Snapshot<any>>>({}).observeOn(Scheduler.immediate));
        cluster = TypeMoq.Mock.ofType(MockCluster);
        cluster.setup(c => c.whoami()).returns(() => "my-address");
        engine = TypeMoq.Mock.ofType(MockProjectionEngine);
        subject = new ClusteredProjectionEngine(engine.object, registry.object, snapshotRepository.object, holder);
    });

    context("when a projection is assigned to a node", () => {
        beforeEach(() => {
            cluster.setup(c => c.lookup("projection1")).returns(() => "not-my-ip");
            cluster.setup(c => c.lookup("projection2")).returns(() => "my-ip");
            subject.restart();
        });
        context("and it was already running", () => {
            beforeEach(() => {
                holder["projection1"].status = ProjectionRunnerStatus.Run;
            });
            it("should keep it like that", () => {
                runner1.verify(r => r.run(), TypeMoq.Times.never());
            });
        });
        context("and it was not running", () => {
            beforeEach(() => {
                holder["projection1"].status = null;
            });
            it("should run that projection", () => {
                runner1.verify(r => r.run(), TypeMoq.Times.once());
            });
        });
    });
    context("when a projection is not assigned anymore to a certain node", () => {
        beforeEach(() => {
            cluster.setup(c => c.lookup("projection1")).returns(() => "not-my-ip");
            cluster.setup(c => c.lookup("projection2")).returns(() => "my-ip");
            subject.restart();
        });
        it("should be shut down", () => {
            runner1.verify(r => r.stop(), TypeMoq.Times.once());
        });
    });
});
