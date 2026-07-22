import { Router } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import postsRouter from "./posts";
import storiesRouter from "./stories";
import reelsRouter from "./reels";
import exploreRouter from "./explore";
import messagesRouter from "./messages";
import notificationsRouter from "./notifications";
import creatorRouter from "./creator";
import gorjetaRouter from "./gorjeta";
import adminRouter from "./admin";

const router: Router = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(postsRouter);
router.use(storiesRouter);
router.use(reelsRouter);
router.use(exploreRouter);
router.use(messagesRouter);
router.use(notificationsRouter);
router.use(creatorRouter);
router.use(gorjetaRouter);
router.use(adminRouter);

export default router;
