import { Module } from '@nestjs/common';
import { StudiosModule } from '../studios/studios.module';
import { TodosController } from './todos.controller';
import { TodosService } from './todos.service';

@Module({
  imports: [StudiosModule],
  controllers: [TodosController],
  providers: [TodosService],
})
export class TodosModule {}
